// ─── 恢复假人上线 ──────────────────────────────────────

import { world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { spawnBot } from "./spawnMode";

/**
 * 恢复离线假人上线
 * - 根据 spawnMode 选择普通/强加载模式
 * - 从记录中取最后位置/重生点
 * - 背包/装备/经验由后续的 playerJoin 事件恢复
 */
export function onlineBot(record: BotRecord): SimulatedPlayer {
  const state = record.lastPoint ?? record.respawnPoint;
  const dim = world.getDimension(state.dimension);

  const bot = spawnBot(record, state.location, dim, state.rotation, state.lookTarget);

  record.online = true;
  record.death = false;

  console.warn(
    `[MockPlayer] 上线假人 ${record.name} 模式=${record.spawnMode ?? "normal"}` +
    `（${state.dimension} ${Math.floor(state.location.x)} ${Math.floor(state.location.y)} ${Math.floor(state.location.z)}）`,
  );
  return bot;
}
