// ─── 三叉戟所属权追踪 ──────────────────────────────────
//
// 用假人名标记抛出的三叉戟投射物，确保实体重建后所属权不丢失。
//
// 流程：
//   1. entitySpawn → 检测三叉戟，owner 属于假人 → addTag("mp:trident:<botName>")
//   2. onlineBot   → 扫描标记三叉戟，重设 owner = 新实体
//
// 覆盖场景：模式切换（chunkload↔normal）、游戏重启、任意实体重建

import { world, EntityProjectileComponent, EntityEquippableComponent, EquipmentSlot } from "@minecraft/server";
import { botRegistry } from "./core/persistence";

/** @internal 导出让 trident.ts 投掷后主动标记 */
export const TAG_PREFIX = "mp:trid:";
const THROWN_TRIDENT = "minecraft:thrown_trident";

// entityId → botName 快速反查（避免遍历 botRegistry）
const entityOwnerMap = new Map<string, string>();

// ─── 初始化 ─────────────────────────────────────────────

/**
 * 订阅 entitySpawn，给假人抛出的三叉戟打永久 tag。
 * 在 worldLoad 后调用一次。
 */
export function initTridentTracker(): void {
  world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (entity.typeId !== THROWN_TRIDENT) return;

    try {
      const proj = entity.getComponent("minecraft:projectile") as EntityProjectileComponent | undefined;

      if (!proj) {
        console.warn(`[MockPlayer] [DBG] 三叉戟生成但无 projectile component`);
        return;
      }

      const owner = proj.owner;
      if (!owner) {
        console.warn(`[MockPlayer] [DBG] 三叉戟生成 ${entity.id} 但 owner 为空`);
        return;
      }

      const botName = entityOwnerMap.get(owner.id);
      if (botName) {
        entity.addTag(`${TAG_PREFIX}${botName}`);
        console.warn(`[MockPlayer] [DBG] 标记三叉戟 ${entity.id} → ${botName}（owner=${owner.id}）`);
      } else {
        console.warn(`[MockPlayer] [DBG] 三叉戟 owner=${owner.id} 不在反查表中（非假人投射物）`);
      }
    } catch (e) {
      console.warn(`[MockPlayer] [DBG] entitySpawn 异常: ${e}`);
    }
  });
}

// ─── 上线/下线跟踪 ─────────────────────────────────────

export function trackBotOnline(entityId: string, botName: string): void {
  entityOwnerMap.set(entityId, botName);
  console.warn(`[MockPlayer] [DBG] 反查表写入 ${entityId} → ${botName}（当前 ${entityOwnerMap.size} 条）`);
}

export function trackBotOffline(entityId: string): void {
  entityOwnerMap.delete(entityId);
  console.warn(`[MockPlayer] [DBG] 反查表删除 ${entityId}（剩余 ${entityOwnerMap.size} 条）`);
}

// ─── 重绑定 ─────────────────────────────────────────────

/**
 * 扫描所有维度中标记的三叉戟，将 owner 重置为假人的当前实体。
 * 在 onlineBot 创建新实体后调用。
 */
export function rebindBotTridents(botName: string): void {
  const record = botRegistry.get(botName);
  if (!record?.entityId) {
    console.warn(`[MockPlayer] [DBG] rebindBotTridents(${botName}) 跳过：无 entityId`);
    return;
  }

  const newOwner = world.getEntity(record.entityId);
  if (!newOwner) {
    console.warn(`[MockPlayer] [DBG] rebindBotTridents(${botName}) 跳过：实体 ${record.entityId} 不存在`);
    return;
  }

  let total = 0;
  const dimIds = ["overworld", "nether", "the_end"];
  for (const dimId of dimIds) {
    try {
      const dim = world.getDimension(dimId);
      const tridents = dim.getEntities({
        tags: [`${TAG_PREFIX}${botName}`],
        type: THROWN_TRIDENT,
      });
      for (const t of tridents) {
        total++;
        try {
          const proj = t.getComponent("minecraft:projectile") as EntityProjectileComponent;
          if (proj) {
            proj.owner = newOwner;
            console.warn(`[MockPlayer] [DBG] 重绑定 ${t.id} → ${botName}(entity=${record.entityId})`);
          }
        } catch {
          console.warn(`[MockPlayer] [DBG] 重绑定 ${t.id} 失败`);
        }
      }
    } catch {
      // 维度不可访问时跳过
    }
  }
  if (total > 0) {
    console.warn(`[MockPlayer] [DBG] rebindBotTridents(${botName}) 完成，共重绑定 ${total} 把三叉戟`);
  }
}


