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

/**
 * 目标方块旁候选站立点（格坐标）：水平 4 方向距离 1/2 优先（人走不进方块
 * 内部，需旁格落脚），对角兜底（宝库/交互方块寻路用）。
 */
export function standSpotCandidates(target: Vec3): Vec3[] {
  const candidates: Vec3[] = [];
  for (const dist of [1, 2]) {
    for (const s of [-1, 1]) {
      candidates.push({ x: target.x + s * dist, y: target.y, z: target.z });
      candidates.push({ x: target.x, y: target.y, z: target.z + s * dist });
    }
  }
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      candidates.push({ x: target.x + dx, y: target.y, z: target.z + dz });
    }
  }
  return candidates;
}

/**
 * 按候选顺序找第一个可站立点（格内可站 + 下方有支撑的判定由调用方注入）。
 * @returns 可站立点（undefined = 目标旁无可站立位置）
 */
export function findStandSpot(target: Vec3, canStandAt: (pos: Vec3) => boolean): Vec3 | undefined {
  for (const pos of standSpotCandidates(target)) {
    if (canStandAt(pos)) return pos;
  }
  return undefined;
}

/** 点集中离中心最近的点（undefined = 空集；扫描最近宝库用） */
export function nearestPoint(center: Vec3, points: Vec3[]): Vec3 | undefined {
  let best: Vec3 | undefined;
  let bestDist = Infinity;
  for (const p of points) {
    const d = distance(center, p);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
