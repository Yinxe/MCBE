// ── 区域统计只读模型（纯逻辑） ──────────────────────────────────────
// 供运行时 stats() / 管理命令 / queryWorld() 共用，可脱离游戏 mock 断言。

import type { RegionLayout } from "./layout";
import { BARREL_SLOTS, capacityOf, totalBarrelsOf, usableSlotsPerBarrel } from "./layout";
import type { RegionMeta } from "./meta";

/** 一个存储区域的统计快照 */
export interface RegionStats {
  /** 区域键：`2:0:-64` */
  key: string;
  /** 完整维度 ID：`minecraft:the_end` */
  dimensionId: string;
  chunkX: number;
  chunkZ: number;
  baseY: number;
  maxLevels: number;
  /** 每桶可分配槽位上限（生效值；缺省 27 = 全部可用） */
  slotPerBarrel: number;
  /** 阵列总槽位数（上限） */
  capacity: number;
  /** 已物化的木桶数（当前；空桶常驻不回收） */
  barrels: number;
  /** 阵列满容量时的木桶总数（静态可预知） */
  totalBarrels: number;
  /** 已占用的槽位数（桶水位计数之和，真值对齐） */
  used: number;
  /** 剩余可用槽位数（= 容量 − 已用） */
  freeSlots: number;
}

/**
 * 从 layout + meta + 桶水位回调计算统计快照（纯函数，可单测）。
 * @param levelUsage 某层桶水位（占用计数数组；缺失/损坏返回空数组）
 */
export function regionStats(
  key: string,
  dimensionId: string,
  layout: RegionLayout,
  meta: RegionMeta,
  levelUsage: (level: number) => number[]
): RegionStats {
  const capacity = capacityOf(layout);
  let used = 0;
  for (let level = 0; level < layout.maxLevels; level++) {
    const usage = levelUsage(level);
    for (const u of usage) {
      if (Number.isInteger(u) && u > 0) used += Math.min(u, BARREL_SLOTS);
    }
  }
  const clamped = Math.min(used, capacity);
  return {
    key,
    dimensionId,
    chunkX: layout.chunkX,
    chunkZ: layout.chunkZ,
    baseY: layout.baseY,
    maxLevels: layout.maxLevels,
    slotPerBarrel: usableSlotsPerBarrel(layout),
    capacity,
    barrels: meta.barrelCount,
    totalBarrels: totalBarrelsOf(layout),
    used: clamped,
    freeSlots: capacity - clamped,
  };
}