// ── 持久化区域记录（纯序列化，零 @minecraft 依赖） ──────────────────────
// 每个存储区域在世界上持久化一条 DP 记录（`nds:item:{key}`）：
//   layout + dimensionId + meta 三合一。
// 这样任意已打包本库的模组都能只读 DP 还原出区域信息做管理查询（无需注册运行时）；
// 后续模组注册同一区块时直接采纳该记录 → 跨模组共享同一存储阵列与分配水印。

import type { RegionLayout } from "./layout";
import type { RegionMeta } from "./meta";

/** 持久化的区域记录（layout 与 meta 合一） */
export interface PersistedRegion {
  readonly v: 1;
  /** 完整维度 ID（如 `minecraft:the_end`） */
  dimensionId: string;
  layout: RegionLayout;
  meta: RegionMeta;
}

/** 新建区域记录（新注册时使用） */
export function createRegionRecord(dimensionId: string, layout: RegionLayout): PersistedRegion {
  return { v: 1, dimensionId, layout, meta: { v: 1, nextFree: 0, freePool: [] } };
}

/** 序列化为 JSON 字符串（DP 值） */
export function serializeRegionRecord(record: PersistedRegion): string {
  return JSON.stringify(record);
}

/** 解析 DP 值；非法/版本不符返回 undefined */
export function parseRegionRecord(json: string): PersistedRegion | undefined {
  try {
    const raw = JSON.parse(json) as PersistedRegion;
    if (raw?.v !== 1 || !raw.dimensionId || !raw.layout || !raw.meta) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}
