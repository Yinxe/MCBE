// ─── 存档读写:把 DynamicProperty 的原始字符串交给 core 归一化 ────
//
// 键名与载荷结构与上游保持一致,老存档可直接升级:
//   teleporter:player:<playerId>  单个玩家的传送点与死亡点
//   teleporter:players            有数据的玩家 ID 索引
//   teleporter:config             世界级配置

import { world } from "@minecraft/server";
import { CONFIG_KEY, normalizeConfig } from "../core/config";
import {
  createEmptyPlayerData,
  type ModConfig,
  type PlayerData,
} from "../core/types";

/** 玩家索引键。 */
const PLAYER_INDEX_KEY = "teleporter:players";

/** 单个玩家存档键。 */
export function playerDataKey(playerId: string): string {
  return `teleporter:player:${playerId}`;
}

/** 读取原始字符串,读不到时返回 undefined。 */
function readRaw(key: string): string | undefined {
  try {
    const value = world.getDynamicProperty(key);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** 写入原始字符串。 */
function writeRaw(key: string, value: string): void {
  try {
    world.setDynamicProperty(key, value);
  } catch (error) {
    console.warn(`[Teleporter] 写入 ${key} 失败: ${String(error)}`);
  }
}

/**
 * 把原始 JSON 归一化为玩家存档。
 *
 * 损坏的载荷回落空存档;缺失的数组字段补空数组;非法条目被丢弃。
 */
export function normalizePlayerData(raw: unknown): PlayerData {
  let source: unknown = raw;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return createEmptyPlayerData();
    }
  }
  if (!source || typeof source !== "object") return createEmptyPlayerData();

  const record = source as Record<string, unknown>;
  const waypoints = Array.isArray(record.waypoints) ? record.waypoints : [];
  const deathPoints = Array.isArray(record.deathPoints)
    ? record.deathPoints
    : [];

  return {
    waypoints: waypoints.filter(isUsableWaypoint) as PlayerData["waypoints"],
    deathPoints: deathPoints.filter(
      isUsableDeathPoint,
    ) as PlayerData["deathPoints"],
  };
}

/** 传送点至少要有一个 id、一个名字和一个坐标,否则视为损坏条目。 */
function isUsableWaypoint(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    hasLocation(record.location)
  );
}

/** 死亡点至少要有一个 id、一个时间和一个坐标。 */
function isUsableDeathPoint(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.deathTime === "number" &&
    hasLocation(record.location)
  );
}

/** 坐标必须是三个数字。 */
function hasLocation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const position = value as Record<string, unknown>;
  return (
    typeof position.x === "number" &&
    typeof position.y === "number" &&
    typeof position.z === "number"
  );
}

/** 读取玩家存档。 */
export function loadPlayerData(playerId: string): PlayerData {
  return normalizePlayerData(readRaw(playerDataKey(playerId)));
}

/** 保存玩家存档,并确保玩家进入索引。 */
export function savePlayerData(playerId: string, data: PlayerData): void {
  writeRaw(playerDataKey(playerId), JSON.stringify(data));
  addToPlayerIndex(playerId);
}

/** 读取世界配置。 */
export function loadConfig(): ModConfig {
  return normalizeConfig(readRaw(CONFIG_KEY));
}

/** 保存世界配置。 */
export function saveConfig(config: ModConfig): void {
  writeRaw(CONFIG_KEY, JSON.stringify(config));
}

/** 读取玩家 ID 索引。 */
export function getAllPlayerIds(): string[] {
  const raw = readRaw(PLAYER_INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** 把玩家 ID 加入索引(已在索引中则不重复写)。 */
function addToPlayerIndex(playerId: string): void {
  const ids = getAllPlayerIds();
  if (ids.indexOf(playerId) !== -1) return;
  ids.push(playerId);
  writeRaw(PLAYER_INDEX_KEY, JSON.stringify(ids));
}

/**
 * 读取所有玩家的存档。
 *
 * 供公共传送点汇总使用;索引里的失效 ID 会返回空存档,不影响结果。
 */
export function loadAllPlayerData(): PlayerData[] {
  const ids = getAllPlayerIds();
  const result: PlayerData[] = [];
  for (const playerId of ids) {
    result.push(loadPlayerData(playerId));
  }
  return result;
}
