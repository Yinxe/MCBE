// ─── 实体解析网关（全系统唯一实体查询入口） ──────────────────────────
// world.getPlayers/getEntity 仅允许出现在本文件（机检纪律）。
// 缓存 TTL ≤10t；查询结果只增不改——查到 ≠ 存在，状态真源在记录（F-19）。
// 失效点：Session 销毁、死亡回调、playerSpawn 对账显式 invalidate。

import { world } from "@minecraft/server";
import type { Player, Entity } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { BOT_MARKER_TAG } from "../domain/Record";
import type { Vec3 } from "../domain/Coords";
import { asSimulated } from "./Compat";
import { clock } from "./Clock";

/** 解析缓存寿命（tick），上限 10（F-19） */
const CACHE_TTL_TICKS = 10;

interface CacheEntry {
  entity: SimulatedPlayer | null;
  atTick: number;
}

export class EntityGateway {
  private readonly cache = new Map<number, CacheEntry>();
  /** botId → 期望显示名（会话建立/改名时同步；实体侧无此映射，名字寻址唯一依据） */
  private readonly names = new Map<number, string>();

  /** 名字 → botId 反查（认主/离场事件只给名字，索引反查唯一合法面） */
  botIdOfName(name: string): number | undefined {
    for (const [id, n] of this.names) {
      if (n === name) return id;
    }
    return undefined;
  }

  /** 登记/更新 botId→名字 映射（同时作废旧缓存） */
  prime(botId: number, name: string): void {
    this.names.set(botId, name);
    this.invalidate(botId);
  }

  /** 会话销毁：清映射与缓存 */
  forget(botId: number): void {
    this.names.delete(botId);
    this.invalidate(botId);
  }

  /**
   * 按 botId 解析在线假人实体（唯一实体入口）。
   * @param knownEntityId 事件现场已持有的实体 id；F-04：死亡窗口 getPlayers
   *   按存活过滤可能查不到刚死实体，凭 id 的 getEntity 仍可读
   * @returns 在线且判别通过返回实体；离线/未登记名字返回 null
   */
  resolveBot(botId: number, knownEntityId?: string): SimulatedPlayer | null {
    const cached = this.cache.get(botId);
    const now = clock.now();
    if (cached && now - cached.atTick <= CACHE_TTL_TICKS && (!cached.entity || this.isAlive(cached.entity))) {
      if (cached.entity || !knownEntityId) return cached.entity;
    }
    const name = this.names.get(botId);
    if (name === undefined) return null;
    let hit: SimulatedPlayer | null = null;
    try {
      // getPlayers({name}) 只返回在线且存活的玩家（F-19）；
      // 引擎对撞名实体加 "(2)" 后缀（F-03），按 name 精确比对兜底
      for (const p of world.getPlayers({ name })) {
        const bot = asSimulated(p);
        if (bot) {
          hit = bot;
          break;
        }
      }
      if (!hit && knownEntityId) hit = this.byId(knownEntityId);
    } catch {
      // 世界初期等瞬态异常：本次不缓存（下 tick 重试）
      return null;
    }
    if (hit || !knownEntityId) this.cache.set(botId, { entity: hit, atTick: now });
    return hit;
  }

  /**
   * 名字占用扫描（上线仲裁）：同名实体 + 带假人标签的 "(N)" 后缀幽灵。
   * @param name 待仲裁的显示名
   * @returns 占用者列表；真人混入由调用方按 BOT_MARKER_TAG 区分
   */
  nameBlockers(name: string): Player[] {
    try {
      const exact = world.getPlayers({ name });
      const ghosts = world.getPlayers({ tags: [BOT_MARKER_TAG] }).filter((p) => p.name.startsWith(`${name}(`));
      return exact.length > 0 ? [exact[0]!, ...ghosts] : ghosts;
    } catch {
      return [];
    }
  }

  /** botId→仲裁名（鱼钩/投射物 tag 等实体侧命名需要；未登记返回 undefined） */
  nameOf(botId: number): string | undefined {
    return this.names.get(botId);
  }

  /** 按 id 取假人句柄（死亡窗口/换实体对账用；无效或非假人返回 null） */
  byId(entityId: string): SimulatedPlayer | null {
    try {
      const e: Entity | undefined = world.getEntity(entityId);
      return e ? (asSimulated(e as Player) ?? null) : null;
    } catch {
      return null;
    }
  }

  /** 按 id 取任意实体（攻击目标等非假人场景；只读定位，句柄不出 engine） */
  rawEntity(entityId: string): Entity | undefined {
    try {
      return world.getEntity(entityId);
    } catch {
      return undefined;
    }
  }

  /** 真实玩家按名解析（无在线同名返回 undefined） */
  findRealPlayer(playerName: string): Player | undefined {
    try {
      return world.getPlayers({ name: playerName }).find((p) => !this.isBot(p));
    } catch {
      return undefined;
    }
  }

  /** 在线真人是否 OP（权限级 ≥2） */
  realPlayerIsOp(playerName: string): boolean {
    if (playerName === "") return false;
    try {
      const p = this.findRealPlayer(playerName);
      return p !== undefined && p.playerPermissionLevel >= 2;
    } catch {
      return false;
    }
  }

  /**
   * 在场真人名单。世界加载完成时玩家通常已在场、join 事件不再重放，须主动点名一次。
   * @returns 真人名字列表
   */
  realPlayerNames(): string[] {
    const out: string[] = [];
    try {
      for (const p of world.getPlayers()) {
        try {
          if (this.isBot(p)) continue;
          out.push(p.name);
        } catch {
          /* 单实体瞬态失效——跳过 */
        }
      }
    } catch {
      return out;
    }
    return out;
  }

  /**
   * 半径内真实玩家清单（播报窗口用）：维度一致 + xz 水平距离；假人不收报。
   * @param dimId 维度 id
   * @param center 圆心
   * @param radius 水平半径（格）
   * @returns 真人实体列表；单实体瞬态失效只跳不清批
   */
  realPlayersNear(dimId: string, center: Vec3, radius: number): Player[] {
    const out: Player[] = [];
    try {
      for (const p of world.getPlayers()) {
        try {
          if (this.isBot(p)) continue;
          if (p.dimension.id !== dimId) continue;
          const l = p.location;
          if (Math.hypot(l.x - center.x, l.z - center.z) <= radius) out.push(p);
        } catch {
          /* 单实体瞬态失效——跳过 */
        }
      }
    } catch {
      return out;
    }
    return out;
  }

  /** 失效单条缓存（死亡/重生/对账点调用） */
  invalidate(botId: number): void {
    this.cache.delete(botId);
  }

  /** 全量失效（worldLoad 对账前） */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** 实体是否携带假人标记（瞬态失效视为非假人） */
  private isBot(entity: { hasTag(tag: string): boolean }): boolean {
    try {
      return entity.hasTag(BOT_MARKER_TAG);
    } catch {
      return false;
    }
  }

  /** 实体句柄有效性回读（缓存命中也要验——disconnect 后句柄即废） */
  private isAlive(entity: SimulatedPlayer): boolean {
    try {
      void entity.name;
      return true;
    } catch {
      return false;
    }
  }
}

/** 进程级单例 */
export const entityGateway = new EntityGateway();
