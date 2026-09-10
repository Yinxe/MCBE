// ─── 生成假人公共尾部逻辑（mc 层） ───────────────────────
// createBot 和 onlineBot 的公共尾部逻辑
// 设置标签 + 体态 + 注册

import { Vector2, Vector3 } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "../../rules/Types";
import { syncEntityTags } from "../basic/EntityTags";
import { saveCoordinator } from "../../bootstrap/context";
import { setBodyPose } from "../basic/PoseGateway";

export function finalizeBotSpawn(
  bot: SimulatedPlayer,
  record: BotRecord,
  rotation: Vector2,
  lookTarget?: Vector3,
  noPose?: boolean,
): void {
  syncEntityTags(bot, record.tags);
  bot.isSneaking = record.isSneaking;
  // 生成/上线恢复只设置身体方向，不启动持续视角；玩家主动同步走 setPose。
  if (!noPose) setBodyPose(bot, rotation);

  // 注册 + 写穿（saveRecord 内含内存 set）
  saveCoordinator.saveRecord(record);
}
