// ─── 传送点纯逻辑:增删改查、排序、分类校验 ─────────────────────
//
// 所有函数都只操作传入的 PlayerData,不碰存档、不碰 @minecraft。

import {
  FALLBACK_CATEGORY,
  WAYPOINT_CATEGORIES,
  generateId,
  type PlayerData,
  type Position,
  type WaypointCategory,
  type WaypointRecord,
} from "./types";

/** 创建传送点的入参。 */
export interface CreateWaypointInput {
  name: string;
  category: WaypointCategory;
  note: string;
  location: Position;
  dimensionId: string;
  ownerId: string;
  ownerName: string;
  biomeInfo?: string;
}

/** 创建结果:成功时 waypoint 有值,失败时 error 是给玩家看的中文提示。 */
export type CreateWaypointResult =
  { ok: true; waypoint: WaypointRecord } | { ok: false; error: string };

/** 判断分类是否合法。 */
export function isValidCategory(value: string): value is WaypointCategory {
  return (WAYPOINT_CATEGORIES as readonly string[]).indexOf(value) !== -1;
}

/** 分类非法时回落为「其他」。 */
export function normalizeCategory(value: string): WaypointCategory {
  return isValidCategory(value) ? value : FALLBACK_CATEGORY;
}

/** 坐标取整,避免存档里出现小数。 */
export function floorPosition(position: Position): Position {
  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z),
  };
}

/**
 * 创建传送点。
 *
 * 校验顺序与上游一致:先查数量上限,再查同名。
 */
export function createWaypoint(
  data: PlayerData,
  input: CreateWaypointInput,
  maxWaypoints: number,
  now: number = Date.now(),
  random: number = Math.random(),
): CreateWaypointResult {
  if (data.waypoints.length >= maxWaypoints) {
    return { ok: false, error: `§c传送点数量已达上限 (${maxWaypoints})` };
  }

  if (findWaypointByName(data, input.name)) {
    return { ok: false, error: `§c已存在同名传送点 §e${input.name}` };
  }

  const waypoint: WaypointRecord = {
    id: generateId(now, random),
    name: input.name,
    category: normalizeCategory(input.category),
    note: input.note,
    biomeInfo: input.biomeInfo ? input.biomeInfo : undefined,
    location: floorPosition(input.location),
    dimensionId: input.dimensionId,
    createdAt: now,
    teleportCount: 0,
    isPinned: false,
    isPublic: false,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
  };

  return { ok: true, waypoint };
}

/** 按 ID 查找。 */
export function findWaypointById(
  data: PlayerData,
  waypointId: string,
): WaypointRecord | undefined {
  return data.waypoints.filter((waypoint) => waypoint.id === waypointId)[0];
}

/** 按名称查找。 */
export function findWaypointByName(
  data: PlayerData,
  name: string,
): WaypointRecord | undefined {
  return data.waypoints.filter((waypoint) => waypoint.name === name)[0];
}

/** 删除。返回是否真的删掉了。 */
export function removeWaypoint(data: PlayerData, waypointId: string): boolean {
  const index = data.waypoints.findIndex(
    (waypoint) => waypoint.id === waypointId,
  );
  if (index === -1) return false;
  data.waypoints.splice(index, 1);
  return true;
}

/** 可编辑字段。传 undefined 表示该字段不变。 */
export interface WaypointEdits {
  name?: string;
  category?: WaypointCategory;
  note?: string;
}

/** 编辑名称、分类、备注。返回是否找到目标。 */
export function editWaypoint(
  data: PlayerData,
  waypointId: string,
  edits: WaypointEdits,
): boolean {
  const waypoint = findWaypointById(data, waypointId);
  if (!waypoint) return false;

  if (edits.name !== undefined) waypoint.name = edits.name;
  if (edits.category !== undefined)
    waypoint.category = normalizeCategory(edits.category);
  if (edits.note !== undefined) waypoint.note = edits.note;
  return true;
}

/** 翻转置顶。 */
export function togglePin(data: PlayerData, waypointId: string): boolean {
  const waypoint = findWaypointById(data, waypointId);
  if (!waypoint) return false;
  waypoint.isPinned = !waypoint.isPinned;
  return true;
}

/** 把坐标与维度更新到给定值。 */
export function updateWaypointLocation(
  data: PlayerData,
  waypointId: string,
  location: Position,
  dimensionId: string,
): boolean {
  const waypoint = findWaypointById(data, waypointId);
  if (!waypoint) return false;
  waypoint.location = floorPosition(location);
  waypoint.dimensionId = dimensionId;
  return true;
}

/**
 * 翻转公共状态。
 *
 * @returns 翻转后的状态;目标不存在返回 undefined;功能被关闭返回 "denied"
 */
export function togglePublic(
  data: PlayerData,
  waypointId: string,
  publicEnabled: boolean,
): boolean | "denied" | undefined {
  if (!publicEnabled) return "denied";
  const waypoint = findWaypointById(data, waypointId);
  if (!waypoint) return undefined;
  waypoint.isPublic = !waypoint.isPublic;
  return waypoint.isPublic;
}

/** 传送次数 +1。目标不存在时静默返回。 */
export function incrementTeleportCount(
  data: PlayerData,
  waypointId: string,
): void {
  const waypoint = findWaypointById(data, waypointId);
  if (!waypoint) return;
  waypoint.teleportCount += 1;
}

/**
 * 排序:置顶优先,其次传送次数降序。
 *
 * 返回新数组,不改动入参顺序。
 */
export function sortWaypoints(
  waypoints: readonly WaypointRecord[],
): WaypointRecord[] {
  const copy = waypoints.slice();
  copy.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.teleportCount - a.teleportCount;
  });
  return copy;
}

/**
 * 汇总所有玩家存档里的公共传送点,按传送次数降序。
 *
 * 功能被关闭时返回空数组。
 */
export function collectPublicWaypoints(
  allPlayerData: readonly PlayerData[],
  publicEnabled: boolean,
): WaypointRecord[] {
  if (!publicEnabled) return [];
  const result: WaypointRecord[] = [];
  for (const data of allPlayerData) {
    for (const waypoint of data.waypoints) {
      if (waypoint.isPublic) result.push(waypoint);
    }
  }
  return sortWaypoints(result);
}
