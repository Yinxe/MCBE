// ─── 移动（导航） ──────────────────────────────────────

import { Vector3, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { BOT_TAG } from "./core/tags";

export function moveBot(record: BotRecord, target: Vector3): boolean {
  if (!record.online || record.death) {
    throw new Error("模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }

  const bot = entity as SimulatedPlayer;
  bot.stopMoving();
  const result = bot.navigateToLocation(target, 1);
  return result.isFullPath;
}
