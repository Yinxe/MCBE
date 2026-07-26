import { Player, Vector3 } from "@minecraft/server";
import { loadPlayerData, savePlayerData, getAllPlayerIds } from "./persistence";
import { loadConfig } from "./config";
import {
  WaypointRecord,
  WaypointCategory,
  WAYPOINT_CATEGORIES,
  generateId,
} from "./types";

// ─── CRUD ───────────────────────────────────────────────────────────

/**
 * 创建新传送点。
 * 如果超过最大数量则返回错误消息。
 *
 * @param biomeInfo - 自动检测的群系名称（可选）
 */
export function createWaypoint(
  player: Player,
  name: string,
  category: WaypointCategory,
  note: string,
  location: Vector3,
  dimensionId: string,
  biomeInfo?: string,
): string | null {
  const data = loadPlayerData(player.id);
  const config = loadConfig();

  if (data.waypoints.length >= config.maxWaypointsPerPlayer) {
    return `§c传送点数量已达上限 (${config.maxWaypointsPerPlayer})`;
  }

  // 检查同名
  if (data.waypoints.some((w) => w.name === name)) {
    return `§c已存在同名传送点 §e${name}`;
  }

  const record: WaypointRecord = {
    id: generateId(),
    name,
    category: validateCategory(category) ? category : "其他",
    note,
    biomeInfo: biomeInfo || undefined,
    location: { x: Math.floor(location.x), y: Math.floor(location.y), z: Math.floor(location.z) },
    dimensionId,
    createdAt: Date.now(),
    teleportCount: 0,
    isPinned: false,
    isPublic: false,
    ownerId: player.id,
    ownerName: player.name,
  };

  data.waypoints.push(record);
  savePlayerData(player.id, data);
  return null; // 成功
}

/**
 * 删除传送点。
 */
export function deleteWaypoint(playerId: string, waypointId: string): boolean {
  const data = loadPlayerData(playerId);
  const idx = data.waypoints.findIndex((w) => w.id === waypointId);
  if (idx === -1) return false;

  data.waypoints.splice(idx, 1);
  savePlayerData(playerId, data);
  return true;
}

/**
 * 编辑传送点（名称、分类、备注）。
 */
export function editWaypoint(
  playerId: string,
  waypointId: string,
  updates: { name?: string; category?: WaypointCategory; note?: string },
): boolean {
  const data = loadPlayerData(playerId);
  const waypoint = data.waypoints.find((w) => w.id === waypointId);
  if (!waypoint) return false;

  if (updates.name !== undefined) waypoint.name = updates.name;
  if (updates.category !== undefined) {
    waypoint.category = validateCategory(updates.category) ? updates.category : "其他";
  }
  if (updates.note !== undefined) waypoint.note = updates.note;
  savePlayerData(playerId, data);
  return true;
}

// ─── Pin / Unpin ────────────────────────────────────────────────────

export function togglePin(playerId: string, waypointId: string): boolean {
  const data = loadPlayerData(playerId);
  const waypoint = data.waypoints.find((w) => w.id === waypointId);
  if (!waypoint) return false;

  waypoint.isPinned = !waypoint.isPinned;
  savePlayerData(playerId, data);
  return true;
}

/**
 * 更新传送点的坐标和维度到当前位置。
 */
export function updateWaypointLocation(
  playerId: string,
  waypointId: string,
  location: Vector3,
  dimensionId: string,
): boolean {
  const data = loadPlayerData(playerId);
  const waypoint = data.waypoints.find((w) => w.id === waypointId);
  if (!waypoint) return false;

  waypoint.location = {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
  waypoint.dimensionId = dimensionId;
  savePlayerData(playerId, data);
  return true;
}

// ─── 公共传送点开关 ─────────────────────────────────────────────────

export function togglePublic(playerId: string, waypointId: string): boolean | "denied" {
  const config = loadConfig();
  if (!config.publicWaypointEnabled) return "denied";

  const data = loadPlayerData(playerId);
  const waypoint = data.waypoints.find((w) => w.id === waypointId);
  if (!waypoint) return false;

  waypoint.isPublic = !waypoint.isPublic;
  savePlayerData(playerId, data);
  return waypoint.isPublic;
}

// ─── 查询 ───────────────────────────────────────────────────────────

/**
 * 获取玩家的传送点列表，按 置顶(desc) → 传送次数(desc) 排序。
 */
export function getSortedWaypoints(playerId: string): WaypointRecord[] {
  const data = loadPlayerData(playerId);
  return sortWaypoints(data.waypoints);
}

/**
 * 获取所有公共传送点，按传送次数(desc)排序。
 * 包含每个传送点的所有者信息。
 */
export function getPublicWaypoints(): WaypointRecord[] {
  const ids = getAllPlayerIds();
  const all: WaypointRecord[] = [];

  for (const pid of ids) {
    const data = loadPlayerData(pid);
    for (const w of data.waypoints) {
      if (w.isPublic) all.push(w);
    }
  }

  return sortWaypoints(all);
}

/**
 * 增加传送次数。
 */
export function incrementTeleportCount(playerId: string, waypointId: string): void {
  const data = loadPlayerData(playerId);
  const waypoint = data.waypoints.find((w) => w.id === waypointId);
  if (!waypoint) return;

  waypoint.teleportCount++;
  savePlayerData(playerId, data);
}

/**
 * 按名称查找传送点。
 */
export function findWaypointByName(playerId: string, name: string): WaypointRecord | undefined {
  const data = loadPlayerData(playerId);
  return data.waypoints.find((w) => w.name === name);
}

// ─── 工具 ───────────────────────────────────────────────────────────

function sortWaypoints(waypoints: WaypointRecord[]): WaypointRecord[] {
  return [...waypoints].sort((a, b) => {
    // 置顶优先
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    // 传送次数降序
    return b.teleportCount - a.teleportCount;
  });
}

function validateCategory(cat: string): cat is WaypointCategory {
  return (WAYPOINT_CATEGORIES as readonly string[]).includes(cat);
}
