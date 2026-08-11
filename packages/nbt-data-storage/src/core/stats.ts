// ── 区域统计只读模型（纯逻辑） ──────────────────────────────────────
// 供运行时 stats() / 管理命令 / queryWorld() 共用，可脱离游戏 mock 断言。

import type { RegionLayout } from "./layout";
import { capacityOf } from "./layout";
import type { RegionMeta } from "./meta";
import { usedSlots } from "./meta";

/** 一个存储区域的统计快照 */
export interface RegionStats {
  /** 区域键：`the_end:0:-64` */
  key: string;
  /** 完整维度 ID：`minecraft:the_end` */
  dimensionId: string;
  chunkX: number;
  chunkZ: number;
  baseY: number;
  maxLevels: number;
  /** 阵列总槽位数（上限） */
  capacity: number;
  /** 视为已占用的槽位数 */
  used: number;
  /** 分配水印（下一个从未用过的槽位 ID） */
  nextFree: number;
  /** 空洞复用池大小 */
  freePoolSize: number;
}

/** 从 layout + meta 计算统计快照（纯函数，可单测） */
export function regionStats(key: string, dimensionId: string, layout: RegionLayout, meta: RegionMeta): RegionStats {
  return {
    key,
    dimensionId,
    chunkX: layout.chunkX,
    chunkZ: layout.chunkZ,
    baseY: layout.baseY,
    maxLevels: layout.maxLevels,
    capacity: capacityOf(layout),
    used: usedSlots(meta),
    nextFree: meta.nextFree,
    freePoolSize: meta.freePool.length,
  };
}
