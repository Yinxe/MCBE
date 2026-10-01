// ─── 掉落物吸附传送（将范围内掉落物移到发起者假人脚下） ────────────
// 掉落物靠碰撞拾取，传送到脚下即算拾取。
// 落点恒为发起者（initiatorBotId）脚下，不选"最近假人"——多假人并发作业时
// 各自的吸附只进自己背包，邻家范围内的掉落不会被截走。
// 归属账（DROP_CLAIM_TICKS 时效）：被某假人吸过的物品在时效内其他假人不再吸，
// 防两假人同 tick 交替把同一物品在彼此脚下传送。
// 物品一次 getEntities 查 minecraft:item；experienceOrbs=true 时另查一次
// minecraft:experience_orb（经验球靠玩家接触获得经验，同样传送到脚下并记入归属账）。
// 均不逐实体查询——密集掉落时是慢日志源。
// 物品 id 走 EntityItemComponent.itemStack.typeId 官方路径；单实体瞬态 try-catch 跳过；
// 脚下取 y+0.5 防地面卡嵌，碰撞判据不变。

import type { Vec3 } from "../domain/Coords";
import { EntityComponentTypes } from "@minecraft/server";
import type { Entity, EntityItemComponent } from "@minecraft/server";
import { botOf, botValid, dimensionOf } from "./Atomic";
import { clock } from "./Clock";

/** 吸附半径（格） */
export const SUCTION_RADIUS = 16;
/** 经验球实体类型 id（玩家接触即获得经验，吸附口径与物品一致） */
const EXPERIENCE_ORB_TYPE = "minecraft:experience_orb";
/** 物品吸附归属时效（tick）：实测拾取窗口内他人不夺，改动需附证据 */
export const DROP_CLAIM_TICKS = 60;
/** 归属账清理触发阈值（条）：超过即顺手清掉过期项 */
const LEDGER_PRUNE_SIZE = 64;

/** 掉落物吸附服务 */
export class DropSuction {
  /** 物品归属账：entityId → 吸它的假人 + 时效截止 */
  private readonly claims = new Map<string, { botId: number; untilTick: number }>();

  /**
   * 以 center 为圆心吸附一帧：范围内 accept 命中、且无主或已在本假人名下的
   * 物品实体逐个传送到发起者（initiatorBotId）脚下并记入归属账；
   * opts.experienceOrbs=true 时半径内经验球同口径一并吸附。
   * @param initiatorBotId - 发起吸附的假人：掉落只算到它自己名下
   * @returns 实际传送的掉落物/经验球数（0=范围内无命中或发起者不在场，正常态）
   */
  suck(
    dimId: string,
    center: Vec3,
    accept: (itemTypeId: string) => boolean,
    initiatorBotId: number,
    opts?: { experienceOrbs?: boolean }
  ): number {
    const dim = dimensionOf(dimId);
    if (!dim) return 0;
    const bot = botOf(initiatorBotId);
    if (!bot || !botValid(bot)) return 0; // 发起者离线/死亡——本轮不吸
    let landing: Vec3;
    try {
      const at = bot.location;
      landing = { x: at.x, y: at.y + 0.5, z: at.z };
    } catch {
      return 0; // 发起者位置瞬态不可读（死亡窗口）
    }
    let items: Entity[] = [];
    try {
      items = [...dim.getEntities({ type: "minecraft:item", location: center, maxDistance: SUCTION_RADIUS })];
    } catch {
      items = []; // 区块/查询瞬态——本轮跳过物品（下次吸附再试）
    }
    let orbs: Entity[] = [];
    if (opts?.experienceOrbs) {
      try {
        orbs = [...dim.getEntities({ type: EXPERIENCE_ORB_TYPE, location: center, maxDistance: SUCTION_RADIUS })];
      } catch {
        orbs = []; // 同口径：查询瞬态本轮跳过经验球
      }
    }
    const now = clock.now();
    if (this.claims.size > LEDGER_PRUNE_SIZE) this.prune(now);
    let moved = 0;
    for (const item of items) {
      try {
        const claim = this.claims.get(item.id);
        if (claim && claim.botId !== initiatorBotId && now < claim.untilTick) continue; // 他人时效内之物
        const typeId = (item.getComponent(EntityComponentTypes.Item) as EntityItemComponent | undefined)?.itemStack
          .typeId;
        if (!typeId || !accept(typeId)) continue;
        item.teleport(landing);
        this.claims.set(item.id, { botId: initiatorBotId, untilTick: now + DROP_CLAIM_TICKS });
        moved++;
      } catch {
        continue; // 单物品瞬态（已被拾取/蒸发）
      }
    }
    for (const orb of orbs) {
      try {
        const claim = this.claims.get(orb.id);
        if (claim && claim.botId !== initiatorBotId && now < claim.untilTick) continue; // 他人时效内之球
        orb.teleport(landing);
        this.claims.set(orb.id, { botId: initiatorBotId, untilTick: now + DROP_CLAIM_TICKS });
        moved++;
      } catch {
        continue; // 单球瞬态（已被吸收/消散）
      }
    }
    return moved;
  }

  /** 假人下线/删除时清 its 名下归属（物品无主可被他人吸走） */
  releaseBot(botId: number): void {
    for (const [eid, c] of this.claims) {
      if (c.botId === botId) this.claims.delete(eid);
    }
  }

  private prune(now: number): void {
    for (const [eid, c] of this.claims) {
      if (now >= c.untilTick) this.claims.delete(eid);
    }
  }
}

/** 进程级单例 */
export const suction = new DropSuction();
