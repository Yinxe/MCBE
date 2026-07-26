import { world } from "@minecraft/server";
import { PlayerData, createEmptyPlayerData } from "./types";

// ─── Key 工具 ───────────────────────────────────────────────────────

function playerDataKey(playerId: string): string {
  return `teleporter:player:${playerId}`;
}

const PLAYER_INDEX_KEY = "teleporter:players";

// ─── 读写 PlayerData ───────────────────────────────────────────────

/**
 * 加载玩家的传送点 + 死亡记录。
 * 如果不存在则返回空数据。
 */
export function loadPlayerData(playerId: string): PlayerData {
  try {
    const raw = world.getDynamicProperty(playerDataKey(playerId));
    if (typeof raw !== "string") return createEmptyPlayerData();
    return JSON.parse(raw) as PlayerData;
  } catch {
    return createEmptyPlayerData();
  }
}

/**
 * 保存玩家的传送点 + 死亡记录。
 */
export function savePlayerData(playerId: string, data: PlayerData): void {
  try {
    world.setDynamicProperty(playerDataKey(playerId), JSON.stringify(data));
    // 确保玩家 ID 被记录在索引中
    addPlayerToIndex(playerId);
  } catch (e: any) {
    console.warn(`[Teleporter] 保存玩家数据失败 (${playerId}): ${e.message}`);
  }
}

/**
 * 删除玩家的所有数据。
 */
export function deletePlayerData(playerId: string): void {
  try {
    world.setDynamicProperty(playerDataKey(playerId), undefined);
    removePlayerFromIndex(playerId);
  } catch (e: any) {
    console.warn(`[Teleporter] 删除玩家数据失败 (${playerId}): ${e.message}`);
  }
}

// ─── 玩家索引 ───────────────────────────────────────────────────────

function addPlayerToIndex(playerId: string): void {
  try {
    const raw = world.getDynamicProperty(PLAYER_INDEX_KEY);
    const ids: string[] = typeof raw === "string" ? JSON.parse(raw) : [];
    if (!ids.includes(playerId)) {
      ids.push(playerId);
      world.setDynamicProperty(PLAYER_INDEX_KEY, JSON.stringify(ids));
    }
  } catch {
    // 忽略
  }
}

function removePlayerFromIndex(playerId: string): void {
  try {
    const raw = world.getDynamicProperty(PLAYER_INDEX_KEY);
    const ids: string[] = typeof raw === "string" ? JSON.parse(raw) : [];
    const filtered = ids.filter((id) => id !== playerId);
    world.setDynamicProperty(PLAYER_INDEX_KEY, JSON.stringify(filtered));
  } catch {
    // 忽略
  }
}

/**
 * 获取所有有数据的玩家 ID 列表（用于枚举公共传送点）。
 */
export function getAllPlayerIds(): string[] {
  try {
    const raw = world.getDynamicProperty(PLAYER_INDEX_KEY);
    return typeof raw === "string" ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
