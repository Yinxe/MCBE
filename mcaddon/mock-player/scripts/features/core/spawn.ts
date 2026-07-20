// ─── 生成假人公共尾部逻辑 ────────────────────────────────
// createBot 和 onlineBot 的公共尾部逻辑
// 设置标签 + 体态 + 注册

import { Vector2, Vector3 } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./types";
import { syncEntityTags } from "./tags";
import { botRegistry, saveBotRecord } from "./persistence";
import { setPose } from "./pose";

export function finalizeBotSpawn(
  bot: SimulatedPlayer,
  record: BotRecord,
  rotation: Vector2,
  lookTarget?: Vector3,
  noPose?: boolean,
): void {
  syncEntityTags(bot, record.tags);
  bot.isSneaking = record.isSneaking;
  if (!noPose) setPose(bot, rotation, lookTarget);

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
