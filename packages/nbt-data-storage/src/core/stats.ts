// ── 区域统计只读模型（纯逻辑） ──────────────────────────────────────
// 供运行时 stats() / 管理命令 / queryWorld() 共用，可脱离游戏 mock 断言。

import type { RegionLayout } from "./layout";
import { capacityOf, totalBarrelsOf, usableSlotsPerBarrel } from "./layout";
import type { RegionMeta } from "./meta";
import { usedSlots } from "./meta";

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
  /** 视为已占用的槽位数 */
  used: number;
  /** 分配水印（下一个从未用过的槽位 ID） */
  nextFree: number;
  /** 空洞总数（各层之和） */
  freePoolSize: number;
}

/** 从 layout + meta 计算统计快照（纯函数，可单测） */
export function regionStats(key: string, dimensionId: string, layout: RegionLayout, meta: RegionMeta): RegionStats {
  const capacity = capacityOf(layout);
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
    // 视为已占用的槽位数：水印 − 空洞（但受可用容量约束——测试布局每桶槽数 <27 时
    // 水印含跳过的不可用槽，clamp 到容量避免 used > capacity 的虚高显示）
    used: Math.min(usedSlots(meta), capacity),
    nextFree: meta.nextFree,
    freePoolSize: meta.holeCount,
  };
}
