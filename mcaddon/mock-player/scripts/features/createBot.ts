// ─── 创建假人 ──────────────────────────────────────────

import { Vector3, Dimension } from "@minecraft/server";

import { BotRecord } from "./core/types";
import { botRegistry, isNameOccupiedInWorld } from "./core/persistence";
import { spawnBot } from "./spawnMode";

export interface CreateBotOptions {
  name: string;
  location: Vector3;
  dimension: Dimension;
  initialTags: string[];
  rotation: Vector3;
  lookTarget: Vector3;
  isSneaking: boolean;
  spawnMode?: "normal" | "chunkload";
}

/**
 * 创建新假人（异步：生成前会等待名称唯一，见 spawnMode）
 * - 已存在的同名假人直接抛错，避免两个 record 争用同一 key 导致数据丢失
 * - 根据 spawnMode 选择普通/强加载模式
 * - 构建 BotRecord（初始标签、位置、重生点）
 * - 背包/装备/经验由 playerJoin 事件从持久化恢复
 */
export async function createBot(options: CreateBotOptions): Promise<BotRecord> {
  const { name, location, dimension, initialTags, rotation, lookTarget, isSneaking, spawnMode } = options;

  // 注册表已有同名记录 → 覆盖会丢旧数据，直接拒绝
  if (botRegistry.has(name)) {
    throw new Error(`假人 ${name} 已存在，请更换名字`);
  }
  // 世界中已有同名玩家实体（真人/在线假人）→ spawn 必然生成 "(2)"，提前拒绝
  if (isNameOccupiedInWorld(name)) {
    throw new Error(`世界中已存在同名玩家实体 ${name}，请更换名字`);
  }

  const rot2 = { x: rotation.x, y: rotation.y };

  const record: BotRecord = {
    name,
    online: true,
    death: false,
    tags: [...initialTags],
    isSneaking,
    spawnMode,
    lastPoint: { location, dimension: dimension.id, rotation: rot2, lookTarget },
    respawnPoint: { location, dimension: dimension.id, rotation: rot2, lookTarget },
    deathPoint: null,
    experience: { level: 0, xpProgress: 0, totalXp: 0 },
  };

  await spawnBot(record, location, dimension, rot2, lookTarget);

  console.info(
    `[MockPlayer] 创建假人 ${name} 模式=${record.spawnMode ?? "normal"}` +
    `（${dimension.id} ${Math.floor(location.x)} ${Math.floor(location.y)} ${Math.floor(location.z)}）`,
  );
  return record;
}
