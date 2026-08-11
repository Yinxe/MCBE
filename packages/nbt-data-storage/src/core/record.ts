// ── 持久化区域记录（纯序列化，零 @minecraft 依赖） ──────────────────────
// 每个存储区域在世界上持久化主记录（`nds:item:{key}`）+ 按层的空洞池（`...:pool:{level}`）：
//   - 主记录：layout + dimensionId + meta（水印/洞索引/洞数，很小）
//   - 空洞池：每层一条 DP 键，存该层的 level-local 空洞索引（单值 ≤ 一层 6912 条）
// 这样任意已打包本库的模组都能只读 DP 还原出区域信息做管理查询（无需注册运行时）；
// 后续模组注册同一区块时直接采纳该记录 → 跨模组共享同一存储阵列与分配水印。

import type { RegionLayout } from "./layout";
import type { RegionMeta } from "./meta";

/** 持久化的区域主记录（layout 与 meta 合一；空洞本体另存于 `...:pool:{level}` 键） */
export interface PersistedRegion {
  readonly v: 2;
  /** 完整维度 ID（如 `minecraft:the_end`） */
  dimensionId: string;
  layout: RegionLayout;
  meta: RegionMeta;
}

/** 新建区域主记录（新注册时使用） */
export function createRegionRecord(dimensionId: string, layout: RegionLayout): PersistedRegion {
  return { v: 2, dimensionId, layout, meta: { v: 2, nextFree: 0, holeLevels: [], holeCount: 0 } };
}

/** 序列化为 JSON 字符串（DP 值） */
export function serializeRegionRecord(record: PersistedRegion): string {
  return JSON.stringify(record);
}

/** 解析 DP 值；非法/版本不符返回 undefined */
export function parseRegionRecord(json: string): PersistedRegion | undefined {
  try {
    const raw = JSON.parse(json) as PersistedRegion;
    if (raw?.v !== 2 || !raw.dimensionId || !raw.layout || !raw.meta) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}
