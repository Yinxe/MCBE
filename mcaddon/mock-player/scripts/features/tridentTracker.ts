// ─── 三叉戟所属权追踪 ──────────────────────────────────
//
// 用假人名标记抛出的三叉戟投射物，确保实体重建后所属权不丢失。
//
// 流程：
//   1. entitySpawn → 检测三叉戟，owner 属于假人 → addTag("mp:trident:<botName>")
//   2. onlineBot   → 扫描标记三叉戟，重设 owner = 新实体
//
// 覆盖场景：模式切换（chunkload↔normal）、游戏重启、任意实体重建

import { world, EntityProjectileComponent } from "@minecraft/server";
import { botRegistry } from "./core/persistence";

const TAG_PREFIX = "mp:trid:";

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
    if (entity.typeId !== "minecraft:trident") return;

    try {
      const proj = entity.getComponent("minecraft:projectile") as EntityProjectileComponent | undefined;
      if (!proj?.owner) return;

      const botName = entityOwnerMap.get(proj.owner.id);
      if (botName) {
        entity.addTag(`${TAG_PREFIX}${botName}`);
      }
    } catch {
      // 安全执行，不阻塞其他逻辑
    }
  });
}

// ─── 上线/下线跟踪 ─────────────────────────────────────

export function trackBotOnline(entityId: string, botName: string): void {
  entityOwnerMap.set(entityId, botName);
}

export function trackBotOffline(entityId: string): void {
  entityOwnerMap.delete(entityId);
}

// ─── 重绑定 ─────────────────────────────────────────────

/**
 * 扫描所有维度中标记的三叉戟，将 owner 重置为假人的当前实体。
 * 在 onlineBot 创建新实体后调用。
 */
export function rebindBotTridents(botName: string): void {
  const record = botRegistry.get(botName);
  if (!record?.entityId) return;

  const newOwner = world.getEntity(record.entityId);
  if (!newOwner) return;

  const dimIds = ["overworld", "nether", "the_end"];
  for (const dimId of dimIds) {
    try {
      const dim = world.getDimension(dimId);
      // getEntities 支持按 tag + type 快速过滤
      const tridents = dim.getEntities({
        tags: [`${TAG_PREFIX}${botName}`],
        type: "minecraft:trident",
      });
      for (const t of tridents) {
        try {
          const proj = t.getComponent("minecraft:projectile") as EntityProjectileComponent;
          if (proj) {
            proj.owner = newOwner;
          }
        } catch {
          // 单把三叉戟失败不影响其他
        }
      }
    } catch {
      // 维度不可访问时跳过
    }
  }
}
