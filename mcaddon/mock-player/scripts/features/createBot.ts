// ─── 创建假人 ──────────────────────────────────────────

import { Vector3, Dimension } from "@minecraft/server";

import { BotRecord } from "./core/types";
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
 * 创建新假人
 * - 根据 spawnMode 选择普通/强加载模式
 * - 构建 BotRecord（初始标签、位置、重生点）
 * - 背包/装备/经验由 playerJoin 事件从持久化恢复
 */
export function createBot(options: CreateBotOptions): BotRecord {
  const { name, location, dimension, initialTags, rotation, lookTarget, isSneaking, spawnMode } = options;
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

  const bot = spawnBot(record, location, dimension, rot2, lookTarget);

  console.warn(
    `[MockPlayer] 创建假人 ${name} 模式=${record.spawnMode ?? "normal"}` +
    `（${dimension.id} ${Math.floor(location.x)} ${Math.floor(location.y)} ${Math.floor(location.z)}）`,
  );
  return record;
}
