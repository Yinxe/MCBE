// ─── 三叉戟所属权追踪 ──────────────────────────────────
//
// 当假人抛出的三叉戟生成时（entitySpawn），用假人名打永久 tag。
// 假人上线时（onlineBot），扫描所有带 tag 的三叉戟，将 owner
// 重设为当前假人实体——确保实体重建后击杀经验不丢失。
//
// 覆盖场景：模式切换（chunkload↔normal）、手动重连、游戏重启

import { world, EntityProjectileComponent } from "@minecraft/server";
import { botRegistry } from "./core/persistence";

const TAG_PREFIX = "mp:trid:";
const THROWN_TRIDENT = "minecraft:thrown_trident";

// entityId → botName 反查表（O(1)，避免遍历 botRegistry）
const entityOwnerMap = new Map<string, string>();

// ─── 初始化 ─────────────────────────────────────────────

/**
 * 订阅 entitySpawn，给假人抛出的三叉戟打 tag。
 * 在 worldLoad 后调用一次。
 */
export function initTridentTracker(): void {
  world.afterEvents.entitySpawn.subscribe((event) => {
    const entity = event.entity;
    if (entity.typeId !== THROWN_TRIDENT) return;

    try {
      const proj = entity.getComponent("minecraft:projectile") as EntityProjectileComponent | undefined;
      if (!proj) {
        console.warn(`[MockPlayer] [DBG] thrown_trident 无 projectile component`);
        return;
      }
      const owner = proj.owner;
      if (!owner) {
        console.warn(`[MockPlayer] [DBG] thrown_trident ${entity.id} owner 为空`);
        return;
      }
      const botName = entityOwnerMap.get(owner.id);
      if (botName) {
        entity.addTag(`${TAG_PREFIX}${botName}`);
        console.warn(`[MockPlayer] [DBG] 标记三叉戟 ${entity.id} → ${botName}`);
      }
    } catch (e) {
      console.warn(`[MockPlayer] [DBG] entitySpawn 异常: ${e}`);
    }
  });
}

// ─── 上线/下线跟踪 ─────────────────────────────────────

export function trackBotOnline(entityId: string, botName: string): void {
  entityOwnerMap.set(entityId, botName);
  console.warn(`[MockPlayer] [DBG] 反查表 += ${botName}（${entityId}）共 ${entityOwnerMap.size} 条`);
}

export function trackBotOffline(entityId: string): void {
  entityOwnerMap.delete(entityId);
  console.warn(`[MockPlayer] [DBG] 反查表 -= ${entityId} 剩余 ${entityOwnerMap.size} 条`);
}

// ─── 重绑定 ─────────────────────────────────────────────

/**
 * 扫描所有维度，将标记三叉戟的 owner 重设为假人当前实体。
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
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try {
      const dim = world.getDimension(dimId);
      const tridents = dim.getEntities({ tags: [`${TAG_PREFIX}${botName}`], type: THROWN_TRIDENT });
      for (const t of tridents) {
        total++;
        try {
          const proj = t.getComponent("minecraft:projectile") as EntityProjectileComponent;
          if (proj) proj.owner = newOwner;
        } catch (e) {
          console.warn(`[MockPlayer] [DBG] 重绑定 ${t.id} 失败: ${e}`);
        }
      }
    } catch {
      // 维度不可访问时跳过
    }
  }
  if (total > 0) {
    console.warn(`[MockPlayer] [DBG] rebindBotTridents(${botName}) 完成，重绑定 ${total} 把三叉戟`);
  }
}


