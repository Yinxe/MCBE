// ─── 生成假人公共尾部逻辑（mc 层） ───────────────────────
// createBot 和 onlineBot 的公共尾部逻辑
// 设置标签 + 体态 + 注册

import { Vector2, Vector3 } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "../../model/Types";
import { syncEntityTags } from "../adapters/EntityTags";
import { saveCoordinator } from "../bootstrap/context";
import { setPose } from "../adapters/PoseGateway";

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

  // 注册 + 写穿（saveRecord 内含内存 set）
  saveCoordinator.saveRecord(record);
}
