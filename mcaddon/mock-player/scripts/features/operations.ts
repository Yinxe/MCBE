// ─── 核心操作（共享业务逻辑） ──────────────────────────
// 所有操作同步执行，需在 system.run() 内调用
// 操作不发送任何消息，由调用层（commands/ui）处理反馈

import { Player, Vector3, world, GameMode, Dimension } from "@minecraft/server";
import { spawnSimulatedPlayer, LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord, PositionState, BOT_TAG } from "./types";
import {
  TAG_CONTROL,
  TAG_IDLE,
  EXCLUSIVE_SET,
  syncEntityTags,
} from "./tags";
import { getPlayerLookTarget } from "./utils";
import { botRegistry, saveBotRecord, removeBotRecord } from "./persistence";

// ─── 创建 ──────────────────────────────────────────────

export interface CreateBotOptions {
  name: string;
  location: Vector3;
  dimension: Dimension;
  initialTags: string[];
  rotation: Vector3;
  lookTarget: Vector3;
  isSneaking: boolean;
}

export function createBot(options: CreateBotOptions): BotRecord {
  const { name, location, dimension, initialTags, rotation, lookTarget, isSneaking } = options;

  const bot = spawnSimulatedPlayer({ x: location.x, y: location.y, z: location.z, dimension }, name, GameMode.Survival);

  const currentState: PositionState = {
    location,
    dimension: dimension.id,
    rotation: { x: rotation.x, y: rotation.y },
    lookTarget,
  };

  const record: BotRecord = {
    name,
    online: true,
    death: false,
    entityId: bot.id,
    tags: [...initialTags],
    isSneaking,
    lastPoint: currentState,
    respawnPoint: currentState,
    deathPoint: null,
  };

  syncEntityTags(bot, record.tags);
  bot.teleport(location, { rotation: { x: rotation.x, y: rotation.y } });
  bot.isSneaking = isSneaking;
  bot.lookAtLocation(lookTarget, LookDuration.Continuous);

  botRegistry.set(name, record);
  saveBotRecord(record);

  return record;
}

// ─── 上线 ──────────────────────────────────────────────

export function onlineBot(record: BotRecord): SimulatedPlayer {
  const state = record.lastPoint ?? record.respawnPoint;
  const dim = world.getDimension(state.dimension);

  const bot = spawnSimulatedPlayer(
    { x: state.location.x, y: state.location.y, z: state.location.z, dimension: dim },
    record.name,
    GameMode.Survival
  );

  syncEntityTags(bot, record.tags);

  bot.teleport(state.location, { rotation: state.rotation });
  bot.isSneaking = record.isSneaking;
  bot.lookAtLocation(state.lookTarget, LookDuration.Continuous);

  record.online = true;
  record.death = false;
  record.entityId = bot.id;
  botRegistry.set(record.name, record);
  saveBotRecord(record);

  return bot;
}

// ─── 下线 ──────────────────────────────────────────────

export function offlineBot(record: BotRecord): void {
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  const online = entity as SimulatedPlayer | undefined;

  if (online && online.hasTag(BOT_TAG)) {
    record.lastPoint = {
      location: online.location,
      dimension: online.dimension.id,
      rotation: online.getRotation(),
      lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
    };
    record.isSneaking = online.isSneaking;
    online.disconnect();
  }

  record.online = false;
  record.entityId = undefined;
  botRegistry.set(record.name, record);
  saveBotRecord(record);
}

// ─── 删除 ──────────────────────────────────────────────

export function deleteBot(record: BotRecord): void {
  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      (entity as SimulatedPlayer).disconnect();
    }
  }
  botRegistry.delete(record.name);
  removeBotRecord(record.name);
}

// ─── 杀死 ──────────────────────────────────────────────

export function killBot(record: BotRecord): void {
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }
  (entity as SimulatedPlayer).kill();
}

// ─── 传送 ──────────────────────────────────────────────

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

// ─── 移动 ──────────────────────────────────────────────

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

// ─── 控制模式 ──────────────────────────────────────────

export function toggleControl(record: BotRecord, player: Player): void {
  const hasControl = record.tags.includes(TAG_CONTROL.value);

  if (hasControl) {
    // 关闭控制
    record.tags = record.tags.filter((t) => t !== TAG_CONTROL.value);
    record.controllerId = undefined;

    const hasExclusive = record.tags.some((t) => EXCLUSIVE_SET.has(t));
    if (!hasExclusive) {
      record.tags.push(TAG_IDLE.value);
    }
  } else {
    // 开启控制
    record.tags = record.tags.filter((t) => !EXCLUSIVE_SET.has(t));
    if (!record.tags.includes(TAG_CONTROL.value)) {
      record.tags.push(TAG_CONTROL.value);
    }
    record.controllerId = player.id;

    // 立即同步一次体态
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
      const lookTarget = getPlayerLookTarget(player);
      (entity as SimulatedPlayer).teleport(player.location, { rotation: player.getRotation() });
      (entity as SimulatedPlayer).lookAtLocation(lookTarget, LookDuration.Continuous);
    }
  }

  // 同步标签到实体
  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}

// ─── 潜行 ──────────────────────────────────────────────

export function setSneaking(record: BotRecord, sneaking: boolean): void {
  record.isSneaking = sneaking;

  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      (entity as Player).isSneaking = sneaking;
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}

// ─── 标签更新 ──────────────────────────────────────────

export function setTags(record: BotRecord, newTags: string[], controllerPlayer?: Player): void {
  const hadControl = record.tags.includes(TAG_CONTROL.value);
  const hasControlNow = newTags.includes(TAG_CONTROL.value);

  record.tags = newTags;

  if (!hasControlNow) {
    record.controllerId = undefined;
  } else if (!hadControl && controllerPlayer) {
    record.controllerId = controllerPlayer.id;
  }

  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
