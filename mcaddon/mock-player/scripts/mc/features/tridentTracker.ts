// ─── 投掷物双任认主追踪（mc 层） ──────────────────────
//
// 双认主机制（两个方向互补）：
//   1. 投掷即标记：投掷物生成（entitySpawn）时，以投射物 owner（实际投掷者）
//      为第一任主人打 tag（玩家或假人皆可）。
//   2. fallback 认主：投掷物实体加载（entityLoad）时，在主人列表中按优先级认主
//      ——第二任（仅假人）在线则认第二任，否则第一任在线认第一任；都离线不动。
//   3. 假人上线夺回：假人上线后 rebindBotTridents 扫描第一/第二任含自己的三叉戟，
//      重设 owner 到当前实体（玩家下线期间被认走的击杀经验回归）。
//
// tag 设计（core/items/TridentClaimRules）：
//   mp:owner:<name>  第一任主人（玩家或假人）
//   mp:owner2:<name> 第二任主人（仅假人，可被后续假人覆盖复写）

import { world, EntityProjectileComponent } from "@minecraft/server";
import type { Entity } from "@minecraft/server";
import { botRegistry } from "../bootstrap/context";
import {
  isTrackedProjectile,
  makeOwnerTag,
  makeSecondOwnerTag,
  parseClaimTags,
  resolveClaimOwner,
} from "../../core/items/TridentClaimRules";

const THROWN_TRIDENT = "minecraft:thrown_trident";

// ─── 初始化 ─────────────────────────────────────────────

/**
 * 订阅 entitySpawn + entityLoad，给投掷物打第一任 tag / fallback 认主。
 * 在 worldLoad 后调用一次。
 */
export function initTridentTracker(): void {
  // ── 投掷即标记：第一任主人 = 实际投掷者（玩家或假人） ──
  world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (!isTrackedProjectile(entity.typeId)) return;
    try {
      // 已有第一任 tag → 跳过（重复 spawn / 已标记）
      if (parseClaimTags(entity.getTags()).firstOwner) return;

      const proj = entity.getComponent("minecraft:projectile") as EntityProjectileComponent | undefined;
      // 投掷者恒为玩家/假人（Player 子类），取 name 作为第一任主人
      const ownerName = proj?.owner ? (proj.owner as { name?: string }).name : undefined;
      if (!ownerName) return;

      entity.addTag(makeOwnerTag(ownerName));
      console.info(`[MockPlayer] 投掷物 ${entity.typeId} ${entity.id} 第一任=${ownerName}`);
    } catch (e) {
      console.info(`[MockPlayer] entitySpawn 认主异常: ${e}`);
    }
  });

  // ── fallback 认主：实体加载时在主人列表中按优先级认主 ──
  // 覆盖场景：未加载区块中的投掷物、游戏重启后区块重载
  world.afterEvents.entityLoad.subscribe((event) => {
    const entity = event.entity;
    if (!isTrackedProjectile(entity.typeId)) return;
    try {
      const { firstOwner, secondOwner } = parseClaimTags(entity.getTags());
      if (!firstOwner && !secondOwner) return;

      // 第二任在线优先，其次第一任在线；都离线不动（等上线夺回）
      const target = resolveClaimOwner(firstOwner, secondOwner, isOwnerOnline);
      if (!target) return;

      const targetEntity = resolveOwnerEntity(target);
      if (!targetEntity) return;

      const proj = entity.getComponent("minecraft:projectile") as EntityProjectileComponent;
      if (proj) {
        proj.owner = targetEntity;
        console.info(`[MockPlayer] entityLoad 认主 ${entity.typeId} ${entity.id} → ${target}`);
      }
    } catch (e) {
      console.info(`[MockPlayer] entityLoad 认主异常: ${e}`);
    }
  });
}

// ─── 在线/实体解析 ─────────────────────────────────────

/** 名字 → 是否在线（假人=registry 有 entityId；玩家=世界中存在） */
function isOwnerOnline(name: string): boolean {
  const record = botRegistry.get(name);
  if (record) return !!record.entityId; // 假人
  try {
    return world.getPlayers({ name }).length > 0; // 玩家
  } catch {
    return false;
  }
}

/** 名字 → 当前实体（假人按 entityId 查；玩家按名字查） */
function resolveOwnerEntity(name: string): Entity | undefined {
  const record = botRegistry.get(name);
  if (record?.entityId) {
    try {
      const e = world.getEntity(record.entityId);
      return e?.isValid ? e : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    return world.getPlayers({ name })[0];
  } catch {
    return undefined;
  }
}

// ─── 上线/下线跟踪（兼容旧调用方） ─────────────────────
// 投掷物认主直接用投射物 owner.name，不再需要实体反查表；
// 保留函数签名供 onlineBot/playerJoin/offlineBot 等调用（仅记录日志）。

export function trackBotOnline(_entityId: string, botName: string): void {
  console.info(`[MockPlayer] 跟踪假人在线 ${botName}`);
}

export function trackBotOffline(_entityId: string): void {
  // no-op
}

// ─── 上线夺回 ─────────────────────────────────────────

/**
 * 假人上线后扫描第一/第二任包含自己的三叉戟，重设 owner 到当前实体。
 * 覆盖场景：模式切换（chunkload↔normal）、手动重连、游戏重启。
 * 由 playerJoin / playerSpawn 调用。
 */
export function rebindBotTridents(botName: string): void {
  const record = botRegistry.get(botName);
  if (!record?.entityId) {
    console.info(`[MockPlayer] rebindBotTridents(${botName}) 跳过：无 entityId`);
    return;
  }

  const newOwner = world.getEntity(record.entityId);
  if (!newOwner) {
    console.info(`[MockPlayer] rebindBotTridents(${botName}) 跳过：实体 ${record.entityId} 不存在`);
    return;
  }

  let total = 0;
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const dim = world.getDimension(dimId);
      const firstOwner = dim.getEntities({ tags: [makeOwnerTag(botName)], type: THROWN_TRIDENT });
      const secondOwner = dim.getEntities({ tags: [makeSecondOwnerTag(botName)], type: THROWN_TRIDENT });
      for (const t of [...firstOwner, ...secondOwner]) {
        total++;
        try {
          const proj = t.getComponent("minecraft:projectile") as EntityProjectileComponent;
          if (proj) proj.owner = newOwner;
        } catch (e) {
          console.info(`[MockPlayer] 重绑定 ${t.id} 失败: ${e}`);
        }
      }
    } catch {
      // 维度不可访问时跳过
    }
  }
  if (total > 0) {
    console.info(`[MockPlayer] rebindBotTridents(${botName}) 完成，重绑定 ${total} 把三叉戟`);
  }
}