// ─── 投掷物双任认主追踪 ────────────────────────────────────────────
// 双认主互补：
// 1. 投掷即标记（entitySpawn）：以 projectile.owner 为第一任打 mp:owner:<名>，已有第一任即跳过
//    （不可变，重复 spawn/拾取再投不覆盖——经验归属链的锚）；附魔/耐久只能在投掷瞬间记
//    （投射物无可读物品组件：mp:item: tag 自 pending 队列队尾消费（LIFO），队空回退投掷者主手）。
// 2. fallback 认主（entityLoad）：按"第二任在线 > 第一任在线"重设 owner，都离线则不动（等上线夺回）。
// 3. 上线夺回/下线回退：上线重绑"最优即自己"的投掷物（防抢他人第二任）；
//    下线只把"第二任=自己"的名下物回退到第一任，标签保留待再夺回。
// 鱼钩同经 entitySpawn 打 mp:fisher:<名>——Angler 钩真值探测的唯一索引（内存标志在重载/竞态下说谎）。

import { Player } from "@minecraft/server";
import type { Entity, ItemStack } from "@minecraft/server";
import type { Vec3 } from "../domain/Coords";
import {
  TRACKED_PROJECTILE_IDS,
  makeFisherTag,
  makeOwner2Tag,
  makeOwnerTag,
  parseOwnerTags,
  resolveClaimOwner,
  encodeItemTag,
} from "../domain/ClaimRules";
import { isFamilyOwned } from "../domain/ClaimRules";
import { CLAIM_SCAN_RADIUS } from "../domain/TridentRules";
import { entityGateway } from "./EntityGateway";
import { dimensionOf } from "./Atomic";
import type { ClaimInfo } from "./Hooks";
import { projectileClaimed } from "./Hooks";

export const FISHING_HOOK_ID = "minecraft:fishing_hook";
/** 三维度全扫（投掷物可跨维度存续） */
const ALL_DIMENSIONS: readonly string[] = ["overworld", "nether", "the_end"];

function isTrackedProjectile(typeId: string): boolean {
  return TRACKED_PROJECTILE_IDS.includes(typeId);
}

/** 桥过滤谓词：Bridges 只转发受跟踪投射物+鱼钩（entitySpawn 全局高频，先降噪） */
export function isBridgeTrackedEntity(typeId: string): boolean {
  return isTrackedProjectile(typeId) || typeId === FISHING_HOOK_ID;
}

/** ItemStack → mp:item: tag（附魔+耐久快照；读不到组件返回 undefined 不拦认主） */
function encodeItemSnapshot(item: ItemStack): string | undefined {
  try {
    const enchantments: { id: string; level: number }[] = [];
    const ench = item.getComponent("minecraft:enchantable") as
      { getEnchantments(): { type: { id: string }; level: number }[] } | undefined;
    for (const e of ench?.getEnchantments() ?? []) enchantments.push({ id: e.type.id, level: e.level });
    const dur = item.getComponent("minecraft:durability") as { damage?: number; maxDurability?: number } | undefined;
    let durability: { current: number; max: number } | undefined;
    if (dur?.maxDurability)
      durability = { current: Math.max(0, dur.maxDurability - (dur.damage ?? 0)), max: dur.maxDurability };
    return encodeItemTag(enchantments, durability);
  } catch {
    return undefined;
  }
}

/** 认主扫描条目（分组/展示决策在 domain clusterPoints + 应用层） */
export interface ClaimEntry {
  entityId: string;
  typeId: string;
  pos: Vec3;
  firstOwner?: string;
  secondOwner?: string;
  itemTag?: string;
}

export class ProjectileTracker {
  /** ownerName → 待打 mp:item: 队列（投掷流程注册队尾，entitySpawn 与 discard 同取队尾） */
  private readonly pending = new Map<string, string[]>();
  /** 反查表 entityId→botName（投掷者实体无 name 属性时兜底；假人上下线维护） */
  private readonly entityNames = new Map<string, string>();

  // ── 反查表生命周期（Bridges/生命周期对账调用） ──

  trackOnline(entityId: string, botName: string): void {
    this.entityNames.set(entityId, botName);
  }

  trackOffline(entityId: string): void {
    this.entityNames.delete(entityId);
  }

  /** 按假人名清全部反查条目（下线时序里 entityId 可能已被换实体覆盖，名字是唯一稳态） */
  untrackBot(botName: string): void {
    for (const [id, name] of this.entityNames) {
      if (name === botName) this.entityNames.delete(id);
    }
  }

  // ── pending 队列（TridentOps 投掷时序调用） ──

  /** 投掷前注册物品快照（队列入尾；串行投掷保证与 entitySpawn 一一对应） */
  registerPending(botId: number, item: ItemStack): void {
    const name = entityGateway.nameOf(botId);
    if (name === undefined) return;
    const tag = encodeItemSnapshot(item);
    if (tag === undefined) return;
    const list = this.pending.get(name) ?? [];
    list.push(tag);
    this.pending.set(name, list);
  }

  /** 投掷失败/中止：丢弃刚注册的队尾条目（防旧附魔错配下一把） */
  discardPending(botId: number): void {
    const name = entityGateway.nameOf(botId);
    if (name === undefined) return;
    const list = this.pending.get(name);
    if (!list || list.length === 0) return;
    list.pop();
    if (list.length === 0) this.pending.delete(name);
  }

  /**
   * entitySpawn 消费快照：串行投掷 ⇒ 本次 spawn 配对的必是最近一次注册，
   * 取队尾（LIFO，与 discardPending 同端）。spawn 事件丢失时旧条目滞留
   * 队首，不会被后续投掷消费。
   */
  private consumePending(ownerName: string): string | undefined {
    const list = this.pending.get(ownerName);
    if (!list || list.length === 0) return undefined;
    const tag = list.pop()!;
    if (list.length === 0) this.pending.delete(ownerName);
    return tag;
  }

  // ── entitySpawn / entityLoad 入口（Bridges 转发，回调内同步执行） ──

  onProjectileSpawn(entity: Entity): void {
    const typeId = entity.typeId;
    if (isTrackedProjectile(typeId)) this.claimOnSpawn(entity);
    else if (typeId === FISHING_HOOK_ID) this.tagFisher(entity);
  }

  onProjectileLoad(entity: Entity): void {
    if (!isTrackedProjectile(entity.typeId)) return;
    try {
      const { firstOwner, secondOwner } = parseOwnerTags(entity.getTags());
      if (!firstOwner && !secondOwner) return;
      const target = resolveClaimOwner(firstOwner, secondOwner, (n) => this.isOwnerOnline(n));
      if (target === undefined) return; // 都离线不动（等上线夺回）
      const targetEntity = this.ownerEntityOf(target);
      if (!targetEntity) return;
      const proj = entity.getComponent("minecraft:projectile") as { owner?: Entity } | undefined;
      if (!proj) return;
      proj.owner = targetEntity;
      this.emit({
        entityId: entity.id,
        typeId: entity.typeId,
        botId: entityGateway.botIdOfName(target),
        claimedBy: target,
        firstOwner,
        previousSecond: secondOwner,
        via: "load",
      });
    } catch {
      /* 单实体瞬态失效——事件回调隔离 */
    }
  }

  // ── 上线夺回 / 下线回退 ──

  /** 假人上线/重生：夺回"当前最优主人即自己"的投掷物（防抢他人第二任） */
  rebind(botId: number): void {
    const name = entityGateway.nameOf(botId);
    const self = entityGateway.resolveBot(botId);
    if (name === undefined || !self) return;
    for (const dimId of ALL_DIMENSIONS) {
      for (const t of [...this.findByTag(dimId, makeOwnerTag(name)), ...this.findByTag(dimId, makeOwner2Tag(name))]) {
        try {
          const { firstOwner, secondOwner } = parseOwnerTags(t.getTags());
          if (resolveClaimOwner(firstOwner, secondOwner, (n) => this.isOwnerOnline(n)) !== name) continue;
          const proj = t.getComponent("minecraft:projectile") as { owner?: Entity } | undefined;
          if (!proj) continue;
          proj.owner = self;
          this.emit({
            entityId: t.id,
            typeId: t.typeId,
            botId,
            claimedBy: name,
            firstOwner,
            previousSecond: secondOwner,
            via: "rebind",
          });
        } catch {
          /* 单条失败继续 */
        }
      }
    }
  }

  /** 假人下线：名下"第二任=自己"的投掷物回绑第一任（在线才回退；标签保留） */
  release(botId: number): void {
    const name = entityGateway.nameOf(botId);
    if (name === undefined) return;
    for (const dimId of ALL_DIMENSIONS) {
      for (const t of [...this.findByTag(dimId, makeOwnerTag(name)), ...this.findByTag(dimId, makeOwner2Tag(name))]) {
        try {
          const { firstOwner, secondOwner } = parseOwnerTags(t.getTags());
          if (secondOwner !== name) continue; // 第一任=自己不可变，无需切换
          if (!firstOwner) continue; // 异常数据无从回退
          const targetEntity = this.ownerEntityOf(firstOwner);
          if (!targetEntity) continue; // 第一任离线——等其上线 rebind
          const proj = t.getComponent("minecraft:projectile") as { owner?: Entity } | undefined;
          if (!proj) continue;
          proj.owner = targetEntity;
          this.emit({
            entityId: t.id,
            typeId: t.typeId,
            botId: entityGateway.botIdOfName(firstOwner),
            claimedBy: firstOwner,
            firstOwner,
            previousSecond: secondOwner,
            via: "offline-fallback",
          });
        } catch {
          /* 忽略单条 */
        }
      }
    }
  }

  // ── UI 认主原语（汇报聚合在应用层） ──

  /**
   * 扫描家族名下投掷物（球形半径 100，仅假人当前维度）。
   * 物品组件缺失不剔除——附魔展示降级、认主功能必须可用。
   * @param familyNames - {主人名 ∪ 主人名下假人名}（应用层索引构造）
   */
  scanOwnProjectiles(botId: number, familyNames: Set<string>): ClaimEntry[] {
    const bot = entityGateway.resolveBot(botId);
    if (!bot) return [];
    const out: ClaimEntry[] = [];
    for (const typeId of TRACKED_PROJECTILE_IDS) {
      try {
        for (const e of bot.dimension.getEntities({
          type: typeId,
          location: bot.location,
          maxDistance: CLAIM_SCAN_RADIUS,
        })) {
          try {
            const { firstOwner, secondOwner, itemTag } = parseOwnerTags(e.getTags());
            if (!firstOwner && !secondOwner) continue;
            if (!isFamilyOwned(firstOwner, secondOwner, familyNames)) continue;
            out.push({
              entityId: e.id,
              typeId: e.typeId,
              pos: { x: e.location.x, y: e.location.y, z: e.location.z },
              firstOwner,
              secondOwner,
              itemTag,
            });
          } catch {
            /* 单条读取失败跳过 */
          }
        }
      } catch {
        /* 维度查询瞬态 */
      }
    }
    return out;
  }

  /**
   * 批量认主为第二任（覆盖复写：先删旧 mp:owner2:* 再打当前）。
   * 投射物组件缺失的件整条不改动，计入失败。
   * @param botId - 认主假人 id
   * @param entityIds - 目标实体 id 列表
   * @returns 成功件数
   */
  claim(botId: number, entityIds: string[]): number {
    const bot = entityGateway.resolveBot(botId);
    const name = entityGateway.nameOf(botId);
    if (!bot || name === undefined) return 0;
    let claimed = 0;
    for (const id of entityIds) {
      try {
        const t = entityGateway.rawEntity(id);
        if (!t || !isTrackedProjectile(t.typeId)) continue;
        const proj = t.getComponent("minecraft:projectile") as { owner?: Entity } | undefined;
        if (!proj) continue; // 读不到组件即认主失败：不改 tag、不发事件
        const { firstOwner, secondOwner: previousSecond } = parseOwnerTags(t.getTags());
        for (const tag of t.getTags()) {
          if (tag.startsWith("mp:owner2:")) t.removeTag(tag);
        }
        t.addTag(makeOwner2Tag(name));
        proj.owner = bot;
        claimed++;
        this.emit({ entityId: t.id, typeId: t.typeId, botId, claimedBy: name, firstOwner, previousSecond, via: "ui" });
      } catch {
        /* 单条失败不影响批量 */
      }
    }
    return claimed;
  }

  // ─── 私有 ──

  private claimOnSpawn(entity: Entity): void {
    try {
      const { firstOwner } = parseOwnerTags(entity.getTags());
      if (firstOwner !== undefined) return; // 已有第一任——不可变，跳过
      const proj = entity.getComponent("minecraft:projectile") as { owner?: Entity } | undefined;
      const owner = proj?.owner;
      if (!owner) return;
      const ownerName = this.resolveOwnerName(owner); // 空名以实体 id 兜底：漏标=认主链断
      entity.addTag(makeOwnerTag(ownerName));
      const itemTag = this.consumePending(ownerName) ?? this.readMainhandTag(owner);
      if (itemTag !== undefined) entity.addTag(itemTag);
      this.emit({
        entityId: entity.id,
        typeId: entity.typeId,
        botId: entityGateway.botIdOfName(ownerName),
        claimedBy: ownerName,
        firstOwner: ownerName,
        via: "spawn",
      });
    } catch {
      /* 事件回调隔离 */
    }
  }

  private tagFisher(entity: Entity): void {
    try {
      const proj = entity.getComponent("minecraft:projectile") as { owner?: Entity } | undefined;
      const owner = proj?.owner;
      if (!owner) return;
      entity.addTag(makeFisherTag(this.resolveOwnerName(owner))); // id 兜底不漏标
    } catch {
      /* 钩可能已消失 */
    }
  }

  /** 投掷者名字解析：反查表 → Player.name/Entity.nameTag → 实体 id 末兜底 */
  private resolveOwnerName(owner: Entity): string {
    return this.entityNames.get(owner.id) ?? ((owner instanceof Player ? owner.name : owner.nameTag) || owner.id); // || 而非 ??：空串同样落 id
  }

  /** 兜底：投掷者主手三叉戟快照（玩家手动投掷无 pending 时） */
  private readMainhandTag(owner: Entity): string | undefined {
    try {
      if (!(owner instanceof Player)) return undefined;
      const container = owner.getComponent("minecraft:inventory")?.container;
      const item = container?.getItem(owner.selectedSlotIndex);
      if (!item || item.typeId !== "minecraft:trident") return undefined;
      return encodeItemSnapshot(item);
    } catch {
      return undefined;
    }
  }

  private isOwnerOnline(name: string): boolean {
    const botId = entityGateway.botIdOfName(name);
    if (botId !== undefined) return entityGateway.resolveBot(botId) !== null;
    return entityGateway.findRealPlayer(name) !== undefined;
  }

  private ownerEntityOf(name: string): Entity | undefined {
    const botId = entityGateway.botIdOfName(name);
    if (botId !== undefined) return entityGateway.resolveBot(botId) ?? undefined;
    return entityGateway.findRealPlayer(name);
  }

  private findByTag(dimId: string, tag: string): Entity[] {
    const out: Entity[] = [];
    try {
      const dim = dimensionOf(dimId);
      if (!dim) return out;
      for (const typeId of TRACKED_PROJECTILE_IDS) {
        try {
          out.push(...dim.getEntities({ tags: [tag], type: typeId }));
        } catch {
          /* 单类型查询失败跳过 */
        }
      }
    } catch {
      /* 维度不可访问 */
    }
    return out;
  }

  private emit(info: ClaimInfo): void {
    projectileClaimed(info);
  }
}

/** 进程级单例 */
export const projectileTracker = new ProjectileTracker();
