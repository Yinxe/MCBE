// ─── 生成模式管理 ──────────────────────────────────────
//
// normal → 模块级 spawnSimulatedPlayer（完全体态控制，无常加载）
// chunkload → test.spawnSimulatedPlayer（强加载区块，不可转向）

import { GameMode } from "@minecraft/server";
import { SimulatedPlayer, spawnSimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "./core/types";
import { finalizeBotSpawn } from "./core/spawn";
import { globalTest } from "./core/gametestContext";

export type SpawnMode = "normal" | "chunkload";

export interface SpawnModeInfo {
  value: SpawnMode;
  label: string;
  desc: string;
  limitations: string[];
}

const MODE_NORMAL = "normal" as const;
const MODE_CHUNKLOAD = "chunkload" as const;

export const MODE_NORMAL_INFO: SpawnModeInfo = {
  value: MODE_NORMAL,
  label: "§a普通模式",
  desc: "完全体态可操控",
  limitations: [],
};

export const MODE_CHUNKLOAD_INFO: SpawnModeInfo = {
  value: MODE_CHUNKLOAD,
  label: "§b强加载模式",
  desc: "区块常加载，但不可转向",
  limitations: [
    "不支持体态同步",
    "TP 时不会设置朝向",
    "扭头可用（仅头部转向，身体不动）",
  ],
};

export function getSpawnModeInfo(mode?: SpawnMode): SpawnModeInfo {
  return mode === MODE_CHUNKLOAD ? MODE_CHUNKLOAD_INFO : MODE_NORMAL_INFO;
}

// ─── 生成入口 ──────────────────────────────────────────

export function spawnBot(
  record: BotRecord,
  location: { x: number; y: number; z: number },
  dimension: any,
  rotation: { x: number; y: number },
  lookTarget?: { x: number; y: number; z: number },
): SimulatedPlayer {
  const mode = record.spawnMode ?? MODE_NORMAL;

  if (mode === MODE_CHUNKLOAD) {
    return doChunkloadSpawn(record, location, dimension);
  }
  return doNormalSpawn(record, location, dimension, rotation, lookTarget);
}

// ─── 普通模式 ──────────────────────────────────────────

function doNormalSpawn(
  record: BotRecord,
  location: any,
  dimension: any,
  rotation: { x: number; y: number },
  lookTarget?: any,
): SimulatedPlayer {
  const bot = spawnSimulatedPlayer(
    { x: location.x, y: location.y, z: location.z, dimension },
    record.name,
    GameMode.Survival,
  );
  // spawnSimulatedPlayer 无视坐标，必须 teleport 校准
  bot.teleport(location, { dimension });
  record.entityId = bot.id;
  finalizeBotSpawn(bot, record, rotation, lookTarget);
  return bot;
}

// ─── 强加载模式 ───────────────────────────────────────

function doChunkloadSpawn(
  record: BotRecord,
  location: any,
  dimension: any,
): SimulatedPlayer {
  if (!globalTest) {
    console.warn(`[MockPlayer] GameTest 未就绪，${record.name} 改用普通模式`);
    const bot = spawnSimulatedPlayer(
      { x: location.x, y: location.y, z: location.z, dimension },
      record.name, GameMode.Survival,
    );
    record.entityId = bot.id;
    finalizeBotSpawn(bot, record, { x: 0, y: 0 }, undefined, true);
    return bot;
  }

  const bot = globalTest.spawnSimulatedPlayer({ x: 0, y: 8, z: 0 }, record.name, GameMode.Survival);
  try {
    (bot as any).setSpawnPoint({ ...location, dimension });
    bot.teleport(location, { dimension });
  } catch (e: any) {
    console.warn(`[MockPlayer] chunkload 传送失败 ${record.name}: ${e?.message ?? e}`);
    bot.disconnect();
    const fallback = spawnSimulatedPlayer(
      { x: location.x, y: location.y, z: location.z, dimension },
      record.name, GameMode.Survival,
    );
    record.entityId = fallback.id;
    finalizeBotSpawn(fallback, record, { x: 0, y: 0 }, undefined, true);
    return fallback;
  }

  record.entityId = bot.id;
  finalizeBotSpawn(bot, record, { x: 0, y: 0 }, undefined, true);
  return bot;
}

// ─── 模式切换 ──────────────────────────────────────────

export function switchSpawnMode(record: BotRecord, newMode: SpawnMode): void {
  record.spawnMode = newMode;
}
