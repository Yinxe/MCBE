// ─── 事件监听处理函数 ──────────────────────────────────

import { world, Player } from "@minecraft/server";
import { SimulatedPlayer, LookDuration } from "@minecraft/server-gametest";

import { BotRecord, PositionState, BOT_TAG } from "./types";
import { TAG_RESPAWN } from "./tags";
import { formatPos, formatDimensionId } from "./utils";
import { botRegistry, saveBotRecord } from "./persistence";

// ─── 假人死亡 ──────────────────────────────────────────

export function onEntityDie(event: any): void {
  const entity = event.deadEntity;
  if (!entity.hasTag(BOT_TAG)) return;
  const record = botRegistry.get(entity.nameTag);
  if (!record) return;

  const bot = entity as SimulatedPlayer;
  const deathState: PositionState = {
    location: entity.location,
    dimension: entity.dimension.id,
    rotation: bot.getRotation(),
    lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
  };

  record.death = true;
  record.deathPoint = deathState;
  record.lastPoint = null;

  world.sendMessage(
    `§7[§a假人§7] §c${record.name} 死亡了 §7@ ${formatPos(deathState.location)} §8${formatDimensionId(deathState.dimension)}`
  );

  // 有自动重生标签 → 自动复活到重生点
  if (entity.hasTag(TAG_RESPAWN.value)) {
    try {
      bot.respawn();
      const dim = world.getDimension(record.respawnPoint.dimension);
      bot.teleport(record.respawnPoint.location, { rotation: record.respawnPoint.rotation });
      bot.isSneaking = record.isSneaking;
      bot.lookAtLocation(record.respawnPoint.lookTarget, LookDuration.Continuous);

      record.death = false;
      record.deathPoint = null;
      record.lastPoint = { ...record.respawnPoint };
      saveBotRecord(record);
      world.sendMessage(`§7[§a假人§7] §b${record.name} 已自动复活`);
      return;
    } catch (e: any) {
      world.sendMessage(`§7[§a假人§7] §c${record.name} 自动重生失败: ${e.message}`);
    }
  }

  // 无自动重生标签 → 死亡下线
  record.online = false;
  record.entityId = undefined;
  saveBotRecord(record);
  bot.disconnect();
  world.sendMessage(`§7[§a假人§7] §e${record.name} 已死亡下线`);
}

// ─── 假人重生（非首次加入） ────────────────────────────

export function onPlayerSpawn(event: any): void {
  if (event.initialSpawn) return;
  const player = event.player;
  if (!player.hasTag(BOT_TAG)) return;
  const record = botRegistry.get(player.name);
  if (record) {
    record.death = false;
    record.online = true;
    saveBotRecord(record);
    world.sendMessage(`§7[§a假人§7] §b${record.name} 重生了`);
  }
}

// ─── 假人加入世界 ──────────────────────────────────────

export function onPlayerJoin(event: any): void {
  const record = botRegistry.get(event.playerName);
  if (!record) return;
  record.online = true;
  world.sendMessage(`§7[§a假人§7] §a${record.name} 加入了游戏`);
}

// ─── 假人离开世界 ──────────────────────────────────────

export function onPlayerLeave(event: any): void {
  const record = botRegistry.get(event.playerName);
  if (!record) return;
  record.online = false;
  record.entityId = undefined;
  saveBotRecord(record);
  world.sendMessage(`§7[§a假人§7] §e${record.name} 离开了游戏`);
}
