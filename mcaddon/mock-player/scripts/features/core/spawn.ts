// ─── 生成假人公共尾部逻辑 ────────────────────────────────
// createBot 和 onlineBot 的公共尾部逻辑
// 设置标签/位置/朝向/注册

import { Vector2, Vector3 } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./types";
import { syncEntityTags } from "./tags";
import { botRegistry, saveBotRecord } from "./persistence";

export function finalizeBotSpawn(
  bot: SimulatedPlayer,
  record: BotRecord,
  location: Vector3,
  rotation: Vector2,
  lookTarget: Vector3,
  isSneaking: boolean,
): void {
  syncEntityTags(bot, record.tags);
  bot.teleport(location, { rotation });
  bot.isSneaking = isSneaking;
  bot.lookAtLocation(lookTarget, LookDuration.Continuous);

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
