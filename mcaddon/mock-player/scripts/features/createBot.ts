// ─── 创建假人 ──────────────────────────────────────────

import { Vector2, Vector3, Dimension, world, GameMode } from "@minecraft/server";
import { spawnSimulatedPlayer, SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord, PositionState } from "./core/types";
import { TAG_BOT, TAG_RESPAWN, TAG_IDLE } from "./core/tags";
import { finalizeBotSpawn } from "./core/spawn";

export interface CreateBotOptions {
  name: string;
  location: Vector3;
  dimension: Dimension;
  initialTags: string[];
  rotation: Vector3;
  lookTarget: Vector3;
  isSneaking: boolean;
}

/**
 * 创建新假人
 * - 生成 SimulatedPlayer
 * - 构建 BotRecord（初始标签、位置、重生点）
 * - 背包/装备/经验由 playerJoin 事件从持久化恢复（新假人无保存数据，自动跳过）
 */
export function createBot(options: CreateBotOptions): BotRecord {
  const { name, location, dimension, initialTags, rotation, lookTarget, isSneaking } = options;

  const bot = spawnSimulatedPlayer(
    { x: location.x, y: location.y, z: location.z, dimension },
    name,
    GameMode.Survival,
  );
  console.warn(
    `[MockPlayer] 创建假人 ${name}（目标 ${dimension.id} ${Math.floor(location.x)} ${Math.floor(location.y)} ${Math.floor(location.z)}）`,
  );

  const currentState: PositionState = {
    location,
    dimension: dimension.id,
    rotation: { x: rotation.x, y: rotation.y },
    lookTarget,
  };

  const record: BotRecord = {
    name,
    online: true,
    death: false,
    entityId: bot.id,
    tags: [...initialTags],
    isSneaking,
    lastPoint: currentState,
    respawnPoint: currentState,
    deathPoint: null,
    experience: { level: 0, xpProgress: 0, totalXp: 0 },
  };

  finalizeBotSpawn(bot, record, location, { x: rotation.x, y: rotation.y }, lookTarget, isSneaking);
  return record;
}
