// ─── 导航裁决纯逻辑（domain） ──────────────────────
// Mover 原子的判定内核：距离预检/到达/停滞全部在此出真值，engine 只喂观测量。
// 统一 ≤16 格普通导航，水平距离预检不过就直接拒绝；常量为引擎实测值，改动需附证据。

import type { Vec3 } from "./Coords";
import { horizontalDistance } from "./Coords";

/** 导航水平上限（格）：超出直接拒绝不发起寻路（远距离易卡/超时且消耗大） */
export const NAV_MAX_DISTANCE = 16;
/** 到达水平判定（格） */
export const NAV_ARRIVE_XZ = 1.5;
/** 到达 Y 容差（F-14：目标层常差几格，3D 严判走不到终点） */
export const NAV_ARRIVE_Y_TOLERANCE = 4;
/** nearby 语义到达（必须 > NAV_ARRIVE_XZ） */
export const NEARBY_ARRIVE_XZ = 2;
/** onNear 回调触发半径（只触发一次） */
export const NAV_NEAR_TRIGGER_XZ = 4;
/** 状态监测间隔（tick） */
export const NAV_CHECK_INTERVAL = 10;
/** 连续静止轮数上限（1 轮=10t 位置完全不变 → 判定已停下） */
export const NAV_STILL_LIMIT = 1;
/** 导航总超时（tick，30s） */
export const NAV_TOTAL_TIMEOUT_TICKS = 600;

/** 导航发起结果（永不 reject）：unavailable=发起时不在线/已死亡；entity_invalid=中途实体失效 */
export type NavOutcome =
  "arrived" | "too_far" | "no_path" | "still_timeout" | "timeout" | "unavailable" | "entity_invalid" | "error";

/**
 * 走位结论（`Mover.walkTo` 的事实裁决口径）：一律由逐拍位置观测得出，不采信引擎发起返回值——
 * navigateToLocation 的 isFullPath=false 只代表"没有到终点的完整路径"，假人在可移动距离内
 * 仍会沿残径靠近，只有超出可移动距离才真不动。
 * arrived=停下且水平达标；stuck=停下但没到位；timeout=预算耗尽仍在挪；
 * entity_invalid=实体失效；cancelled=被同 bot 的新走位或急停取消；error=发起抛穿。
 */
export type WalkOutcome = "arrived" | "stuck" | "timeout" | "entity_invalid" | "cancelled" | "error";

/** 导航是否可发起（水平距离预检） */
export function canNavigate(from: Vec3, to: Vec3): boolean {
  return horizontalDistance(from, to) <= NAV_MAX_DISTANCE;
}

/**
 * 导航到达判定：需已停下，水平达标且纵向在容差内。
 * @param still - 已判定停下（静止轮数达上限）
 */
export function isArrived(xzDist: number, dy: number, still: boolean): boolean {
  return still && xzDist <= NAV_ARRIVE_XZ && Math.abs(dy) <= NAV_ARRIVE_Y_TOLERANCE;
}

/** nearby 模式到达判定：水平放宽，仍要求停下 */
export function isArrivedNearby(xzDist: number, still: boolean): boolean {
  return still && xzDist <= NEARBY_ARRIVE_XZ;
}

/** onNear 触发判定 */
export function isNearTrigger(xzDist: number): boolean {
  return xzDist <= NAV_NEAR_TRIGGER_XZ;
}

/** 导航停滞且未达标 → 卡死 */
export function isStuck(xzDist: number, dy: number, stillCount: number, nearby: boolean): boolean {
  if (stillCount < NAV_STILL_LIMIT) return false;
  return nearby ? xzDist > NEARBY_ARRIVE_XZ : !(xzDist <= NAV_ARRIVE_XZ && Math.abs(dy) <= NAV_ARRIVE_Y_TOLERANCE);
}
