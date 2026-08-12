// ── 持久化区域记录（纯序列化，零 @minecraft 依赖） ──────────────────────
// 每个存储区域在世界上持久化主记录（`nds:item:{key}`）+ 按层的桶水位（`...:usage:{level}`）：
//   - 主记录：layout + dimensionId + meta（v3：仅 barrelCount，很小）
//   - 桶水位：每层一条 DP 键，存该层已物化桶的占用计数数组（每桶一个 0..27 数字，
//     满层 256 个 ≈ 640B——远低于 DP 单值 32KB 上限，无需分片）
// 这样任意已打包本库的模组都能只读 DP 还原出区域信息做管理查询（无需注册运行时）；
// 后续模组注册同一区块时直接采纳该记录 → 跨模组共享同一存储阵列。
// v2（空洞池时代）记录兼容读取：meta 归一化为 v3（洞信息丢弃，见 meta.normalizeMeta）。

import type { RegionLayout } from "./layout";
import { BARREL_SLOTS, MAX_LEVELS } from "./layout";
import { normalizeMeta, type RegionMeta } from "./meta";

/** 持久化的区域主记录（layout 与 meta 合一；桶水位另存于 `...:usage:{level}` 键） */
export interface PersistedRegion {
  readonly v: 2;
  /** 完整维度 ID（如 `minecraft:the_end`） */
  dimensionId: string;
  layout: RegionLayout;
  meta: RegionMeta;
}

/** 新建区域主记录（新注册时使用） */
export function createRegionRecord(dimensionId: string, layout: RegionLayout): PersistedRegion {
  return { v: 2, dimensionId, layout, meta: { v: 3, barrelCount: 0 } };
}

/** 序列化为 JSON 字符串（DP 值） */
export function serializeRegionRecord(record: PersistedRegion): string {
  return JSON.stringify(record);
}

/** 解析 DP 值；垃圾/版本不符/**字段损坏**返回 undefined */
export function parseRegionRecord(json: string): PersistedRegion | undefined {
  try {
    const raw = JSON.parse(json) as PersistedRegion & { meta?: unknown };
    if (raw?.v !== 2 || !raw.dimensionId || !raw.layout || !raw.meta || !raw.layout) return undefined;
    // 字段级校验：损坏记录（水印巨大/负数、layout 非法等）直接拒绝，
    // 防止巡检/重建按坏数据空转卡死或统计荒谬
    const { layout } = raw;
    if (
      !Number.isInteger(layout.chunkX) ||
      !Number.isInteger(layout.chunkZ) ||
      !Number.isInteger(layout.baseY) ||
      !Number.isInteger(layout.maxLevels) ||
      layout.maxLevels < 1 ||
      layout.maxLevels > MAX_LEVELS ||
      (layout.slotPerBarrel !== undefined &&
        (!Number.isInteger(layout.slotPerBarrel) || layout.slotPerBarrel < 0 || layout.slotPerBarrel > BARREL_SLOTS))
    ) {
      return undefined;
    }
    const meta = normalizeMeta(raw.meta);
    if (!meta) return undefined;
    return { v: 2, dimensionId: raw.dimensionId, layout, meta };
  } catch {
    return undefined;
  }
}