// ─── 恢复假人上线 ──────────────────────────────────────

import { system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { spawnBot } from "./spawnMode";
import { trackBotOnline, rebindBotTridents } from "./tridentTracker";

/**
 * 恢复离线假人上线
 * - 根据 spawnMode 选择普通/强加载模式
 * - 从记录中取最后位置/重生点
 * - 背包/装备/经验由后续的 playerJoin 事件恢复
 * - 上线后重绑定该假人之前抛出的三叉戟（确保所属权不丢失）
 */
export function onlineBot(record: BotRecord): SimulatedPlayer {
  const state = record.lastPoint ?? record.respawnPoint;
  const dim = world.getDimension(state.dimension);

  const bot = spawnBot(record, state.location, dim, state.rotation, state.lookTarget);

  record.online = true;
  record.death = false;

  // 加入反查表（entityId → botName），供 entitySpawn 标记三叉戟用
  trackBotOnline(bot.id, record.name);

  // 下一 tick 重绑定该假人之前抛出的三叉戟（此时实体已完全就绪）
  system.run(() => rebindBotTridents(record.name));

  console.warn(
    `[MockPlayer] 上线假人 ${record.name} 模式=${record.spawnMode ?? "normal"}` +
    `（${state.dimension} ${Math.floor(state.location.x)} ${Math.floor(state.location.y)} ${Math.floor(state.location.z)}）`,
  );
  return bot;
}
