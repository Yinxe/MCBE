// ─── 聚集概率计算（core 层） ───────────────────────────
// 纯数学：对坐标集做邻居密度统计，扎堆越近聚集概率越大。
// 用于三叉戟认主 UI 的列表排序（按概率降序）。

import type { Vec3 } from "../model/Types";

/**
 * 计算每个点的聚集概率（0-1）。
 *
 * 算法：对每个点统计半径 radius 内（含自身）的其它点数量，
 * 归一化为 (邻居数) / (N-1)。N=1 时概率为 0。
 * 扎堆的点邻居多 → 概率大；孤立点概率小。
 *
 * @param points 点坐标集
 * @param radius 邻居判定半径（方块）
 * @returns 与输入同序的概率数组（0-1，百分比展示时乘 100）
 */
export function computeClusterProbabilities(points: readonly Vec3[], radius: number): number[] {
  const n = points.length;
  if (n <= 1) return new Array(n).fill(0);

  const radiusSq = radius * radius;
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    let neighbors = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const q = points[j]!;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dz = p.z - q.z;
      if (dx * dx + dy * dy + dz * dz <= radiusSq) neighbors++;
    }
    result.push(n > 1 ? neighbors / (n - 1) : 0);
  }
  return result;
}

/** 带概率的坐标条目（认主 UI 展示与排序用） */
export interface ClusteredPoint {
  /** 原始下标 */
  index: number;
  /** 坐标 */
  pos: Vec3;
  /** 聚集概率 0-1 */
  probability: number;
}

/**
 * 坐标集 + 概率 → 按概率降序排列的条目列表
 * （概率相同按原始下标升序，保证稳定输出）
 */
export function sortByClusterProbability(points: readonly Vec3[], radius: number): ClusteredPoint[] {
  const probs = computeClusterProbabilities(points, radius);
  return points
    .map((pos, index) => ({ index, pos, probability: probs[index] ?? 0 }))
    .sort((a, b) => b.probability - a.probability || a.index - b.index);
}