// ─── 传送 ──────────────────────────────────────────────

import { Player, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { BOT_TAG } from "./core/tags";
import { botRegistry, saveBotRecord } from "./core/persistence";
import { setPose } from "./core/pose";
import { getPlayerLookTarget, savePoseToRecord } from "./core/pose";

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
  const lookTarget = getPlayerLookTarget(player);
  setPose(bot, player.getRotation(), lookTarget);
  bot.isSneaking = player.isSneaking;

  record.isSneaking = player.isSneaking;
  savePoseToRecord(record, player.location, player.dimension.id, player.getRotation(), lookTarget);
  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
