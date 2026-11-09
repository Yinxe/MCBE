// ─── 传送点的业务动作 ───────────────────────────────────────────
//
// 命令与界面都要做「按名字传送 / 按名字删除 / 在当前位置创建」,
// 放在这里保证两条入口走同一套校验与计次规则。

import type { Player } from "@minecraft/server";
import {
  createWaypoint,
  incrementTeleportCount,
  removeWaypoint,
  togglePin,
  togglePublic,
  type WaypointEdits,
} from "../core/waypoints";
import type { WaypointCategory } from "../core/types";
import { detectBiomeName } from "./detection";
import { loadConfig, loadPlayerData, savePlayerData } from "./store";
import { teleportToSavedPoint } from "./teleport";

/** 创建结果。失败时 error 是给玩家看的中文提示。 */
export type CreateWarpOutcome =
  { ok: true; name: string } | { ok: false; error: string };

/** 按名字找玩家自己的传送点。 */
export function findOwnWarp(player: Player, name: string) {
  const data = loadPlayerData(player.id);
  return data.waypoints.filter((item) => item.name === name)[0];
}

/**
 * 传送到自己的某个传送点。
 *
 * 先确认传送成功再累加次数,避免失败也涨计数。
 *
 * @returns 传送是否成功
 */
export function warpToWaypoint(player: Player, waypointId: string): boolean {
  const data = loadPlayerData(player.id);
  const waypoint = data.waypoints.filter((item) => item.id === waypointId)[0];
  if (!waypoint) return false;

  const ok = teleportToSavedPoint(
    player,
    waypoint.name,
    waypoint.location,
    waypoint.dimensionId,
  );
  if (!ok) return false;

  incrementTeleportCount(data, waypoint.id);
  savePlayerData(player.id, data);
  return true;
}

/** 按名字传送到自己的传送点。找不到时提示并返回 false。 */
export function warpToWaypointByName(player: Player, name: string): boolean {
  const waypoint = findOwnWarp(player, name);
  if (!waypoint) {
    player.sendMessage(
      `§c未找到传送点 §e${name}§c,使用 §6/tpa:warps §c查看所有传送点`,
    );
    return false;
  }
  return warpToWaypoint(player, waypoint.id);
}

/** 按名字删除自己的传送点。找不到时提示并返回 false。 */
export function deleteWaypointByName(player: Player, name: string): boolean {
  const waypoint = findOwnWarp(player, name);
  if (!waypoint) {
    player.sendMessage(`§c未找到传送点 §e${name}`);
    return false;
  }

  const data = loadPlayerData(player.id);
  removeWaypoint(data, waypoint.id);
  savePlayerData(player.id, data);
  player.sendMessage(`§c已删除传送点 §e${name}`);
  return true;
}

/** 创建传送点的入参。分类与备注不传时按群系自动推荐。 */
export interface CreateWarpOptions {
  category?: WaypointCategory;
  note?: string;
}

/**
 * 在玩家当前位置创建传送点,自动检测群系。
 *
 * @returns 成功时带上传送点名称,失败时带上给玩家看的提示
 */
export function createWarpAtPlayer(
  player: Player,
  name: string,
  options: CreateWarpOptions = {},
): CreateWarpOutcome {
  const biomeInfo = detectBiomeName(player.dimension, player.location);

  const data = loadPlayerData(player.id);
  const config = loadConfig();

  const result = createWaypoint(
    data,
    {
      name,
      category: options.category ?? "其他",
      note: options.note ?? (biomeInfo ? `位于 ${biomeInfo}` : ""),
      location: player.location,
      dimensionId: player.dimension.id,
      ownerId: player.id,
      ownerName: player.name,
      biomeInfo,
    },
    config.maxWaypointsPerPlayer,
  );

  if (!result.ok) return { ok: false, error: result.error };

  data.waypoints.push(result.waypoint);
  savePlayerData(player.id, data);
  return { ok: true, name };
}

/** 编辑自己的传送点,并把变更写回存档。 */
export function applyWaypointEdits(
  player: Player,
  waypointId: string,
  edits: WaypointEdits,
): boolean {
  const data = loadPlayerData(player.id);
  const waypoint = data.waypoints.filter((item) => item.id === waypointId)[0];
  if (!waypoint) return false;

  if (edits.name !== undefined) waypoint.name = edits.name;
  if (edits.category !== undefined) waypoint.category = edits.category;
  if (edits.note !== undefined) waypoint.note = edits.note;

  savePlayerData(player.id, data);
  return true;
}

/**
 * 翻转公共状态并提示结果。
 *
 * @returns 翻转后的状态;目标不存在或被功能关闭时返回 undefined
 */
export function switchWaypointPublic(
  player: Player,
  name: string,
): boolean | undefined {
  const data = loadPlayerData(player.id);
  const waypoint = data.waypoints.filter((item) => item.name === name)[0];
  if (!waypoint) {
    player.sendMessage(`§c未找到传送点 §e${name}`);
    return undefined;
  }

  const config = loadConfig();
  const result = togglePublic(data, waypoint.id, config.publicWaypointEnabled);
  if (result === "denied") {
    player.sendMessage("§c公共传送点功能已被管理员关闭");
    return undefined;
  }
  if (result === undefined) return undefined;

  savePlayerData(player.id, data);
  player.sendMessage(`§a§e${name} §a已${result ? "设为" : "取消"}公共传送点`);
  return result;
}

/** 翻转置顶并把变更写回存档。 */
export function applyWaypointPin(
  player: Player,
  waypointId: string,
  pinned: boolean,
): boolean {
  const data = loadPlayerData(player.id);
  const waypoint = data.waypoints.filter((item) => item.id === waypointId)[0];
  if (!waypoint) return false;
  if (waypoint.isPinned === pinned) return true;

  togglePin(data, waypoint.id);
  savePlayerData(player.id, data);
  return true;
}
