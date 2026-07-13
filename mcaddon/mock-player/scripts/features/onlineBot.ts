// ─── 恢复假人上线 ──────────────────────────────────────

import { world, GameMode } from "@minecraft/server";
import { SimulatedPlayer, spawnSimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { finalizeBotSpawn } from "./core/spawn";

/**
 * 恢复离线假人上线
 * - 模块级 spawnSimulatedPlayer（不受 GameTest 锁定）
 * - 从记录中取最后位置/重生点
 * - 背包/装备/经验由后续的 playerJoin 事件恢复
 */
export function onlineBot(record: BotRecord): SimulatedPlayer {
  const state = record.lastPoint ?? record.respawnPoint;
  const dim = world.getDimension(state.dimension);

  const bot = spawnSimulatedPlayer(
    { x: state.location.x, y: state.location.y, z: state.location.z, dimension: dim },
    record.name,
    GameMode.Survival,
  );
  console.warn(
    `[MockPlayer] 上线假人 ${record.name}（${state.dimension} ${Math.floor(state.location.x)} ${Math.floor(state.location.y)} ${Math.floor(state.location.z)}）`,
  );

  // 背包/装备/经验在 playerJoin 事件中恢复

  record.online = true;
  record.death = false;
  record.entityId = bot.id;
  finalizeBotSpawn(bot, record, state.rotation, state.lookTarget);

  return bot;
}
