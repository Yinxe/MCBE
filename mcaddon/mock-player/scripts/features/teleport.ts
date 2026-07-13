// ─── 传送 ──────────────────────────────────────────────

import { Player, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { BOT_TAG } from "./core/tags";
import { botRegistry, saveBotRecord } from "./core/persistence";
import { setPose, getPlayerLookTarget } from "./bodyPose";

export function tpPlayerToBot(player: Player, record: BotRecord): void {
  if (!record.online || record.death) {
    throw new Error("模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }
  player.teleport(entity.location, { dimension: entity.dimension });
}

export function tpBotToPlayer(record: BotRecord, player: Player): void {
  if (!record.online || record.death) {
    throw new Error("模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }

  const bot = entity as SimulatedPlayer;

  bot.teleport(player.location, { dimension: player.dimension });
  setPose(bot, player.getRotation(), getPlayerLookTarget(player));
  bot.isSneaking = player.isSneaking;

  record.isSneaking = player.isSneaking;
  if (record.lastPoint) {
    record.lastPoint.location = player.location;
    record.lastPoint.dimension = player.dimension.id;
    record.lastPoint.rotation = player.getRotation();
    // record.lastPoint.lookTarget 由 bodyPose 模块管理
  }
  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
