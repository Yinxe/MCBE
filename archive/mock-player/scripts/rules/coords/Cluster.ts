// ─── 聚集概率计算（core 层） ───────────────────────────
// 纯数学：对坐标集做邻居密度统计，扎堆越近聚集概率越大。
// 用于三叉戟认主 UI 的列表排序（按概率降序）。

import type { Vec3 } from "../Types";

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

  // 防御：负数半径按 0 处理（仅同坐标算邻居），避免平方后误放大
  const r = Math.max(0, radius);
  const radiusSq = r * r;
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

// ─── 空间聚集分组 ──────────────────────────────────────

/**
 * 按空间邻近分组：距离 ≤ radius 的点为同组（链式连通——A-B 邻、B-C 邻则 A/B/C 一组）。
 * 用于投掷物认主 UI 的聚集分组（半径 3 格一个聚集范围），
 * 返回与输入同序的点组列表，组内保持原顺序。
 *
 * 实现：并查集（union-find），O(n²) 距离判定，投掷物数量级（几十个）内开销可忽略。
 *
 * @param points 点列表（需带 pos 字段）
 * @param radius 分组判定半径（方块）
 * @returns 分组列表（每组一个数组，含 ≥1 个点；顺序按首点出现次序）
 */
export function groupPointsByProximity<T extends { pos: Vec3 }>(
  points: readonly T[],
  radius: number
): T[][] {
  const n = points.length;
  if (n === 0) return [];

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const r = Math.max(0, radius);
  const r2 = r * r;
  for (let i = 0; i < n; i++) {
    const p = points[i]!.pos;
    for (let j = i + 1; j < n; j++) {
      const q = points[j]!.pos;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dz = p.z - q.z;
      if (dx * dx + dy * dy + dz * dz <= r2) union(i, j);
    }
  }

  const groups = new Map<number, T[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(points[i]!);
    groups.set(root, list);
  }
  return [...groups.values()];
}