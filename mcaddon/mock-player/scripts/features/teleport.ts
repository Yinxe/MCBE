// ─── 传送 ──────────────────────────────────────────────

import { Player, world } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { BOT_TAG } from "./core/tags";
import { botRegistry, saveBotRecord } from "./core/persistence";
import { getPlayerLookTarget } from "./core/utils";

export function tpPlayerToBot(player: Player, record: BotRecord): void {
  if (!record.online || record.death) {
    throw new Error("模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }
  player.teleport(entity.location);
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
  const playerRot = player.getRotation();
  const lookTarget = getPlayerLookTarget(player);

  bot.teleport(player.location, { rotation: playerRot });
  bot.lookAtLocation(lookTarget, LookDuration.Continuous);
  bot.isSneaking = player.isSneaking;

  record.isSneaking = player.isSneaking;
  if (record.lastPoint) {
    record.lastPoint.location = player.location;
    record.lastPoint.dimension = player.dimension.id;
    record.lastPoint.rotation = playerRot;
    record.lastPoint.lookTarget = lookTarget;
  }
  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
