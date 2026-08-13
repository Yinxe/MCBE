// ─── 导航纯逻辑（core 层零依赖，可 node 单测） ────────
// 距离/到达/超时判定——mc 层 NavigateToTask 等导航任务的地基。

import type { Vec3 } from "../model/Types";

/** 3D 欧氏距离 */
export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 是否已到达（距离 ≤ 到达阈值） */
export function isArrived(dist: number, arriveDist: number): boolean {
  return dist <= arriveDist;
}

/** 是否已超时（累计推进 tick ≥ 超时阈值） */
export function isTimedOut(elapsedTicks: number, timeoutTicks: number): boolean {
  return elapsedTicks >= timeoutTicks;
}
