// ── ItemStorage：存储区域注册表（mc 适配层，对外唯一入口） ──────────────
// 模组以 `ItemStorage.register({ dimension, anchor, baseY, maxLevels })` 注册一个
// "区块锚定的全木桶阵列"：
//   - 锚点任意坐标 → 所在区块即存储地址（同维度同区块 → 同一阵列 → 多模组共享）
//   - 世界已有该区域持久化记录（别的模组先建）→ 采纳其布局与维度，共享数据
//   - 全新区域 → 写持久化记录 + ticking area 常加载 + 追加全局索引
// 存储最小单位 = 每个木桶格子的 ItemStack（完整 NBT）；put 成功返回唯一格子 ID，
// get/take/remove 按 ID 纯算术 O(1) 秒定位。
import { world } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import { chunkFromAnchor, validateLayout, type RegionLayout } from "../core/layout";
import { regionKey, shortDimension } from "../core/keys";
import { createRegionRecord } from "../core/record";
import { regionStats, type RegionStats } from "../core/stats";
import { StoredRegion } from "./StoredRegion";
import { appendRegionIndex, readRegionIndex, readRegionRecord, writeRegionRecord } from "./store";

/** 默认底层木桶 Y（末地虚空高度，避让末地主岛/黑曜石柱） */
const DEFAULT_BASE_Y = 120;
/** 默认纵向层数上限（4 层 × 256 桶 × 27 槽 = 27648 槽） */
const DEFAULT_MAX_LEVELS = 4;

/** 注册参数：维度 + 锚点坐标（决定区块地址），可选 baseY / maxLevels */
export interface RegisterOptions {
  /** 完整维度 ID（推荐 `minecraft:the_end`） */
  dimension: string;
  /** 锚点坐标：任意坐标 → 所在区块为存储地址 */
  anchor: Vector3;
  /** 最底层木桶 Y（默认 120；仅首个注册该区块的模组生效） */
  baseY?: number;
  /** 纵向木桶层数上限（默认 4；仅首个注册该区块的模组生效） */
  maxLevels?: number;
}

/** 世界视角的区域统计（只读，供其他模组管理读取） */
export type RegionWorldInfo = RegionStats;

/** 本上下文（本模组脚本）已注册的区域，按区域键索引 */
const regions = new Map<string, StoredRegion>();

/**
 * 注册/获取一个存储区域（幂等）。
 * - 已在本上下文注册 → 直接返回既有实例；
 * - 世界已有该区域记录（其他模组先建）→ 采纳其维度与布局，共享同一阵列；
 * - 全新 → 按传入参数创建并持久化。
 *
 * @throws 维度无效 / 布局非法时抛中文错误
 */
export function register(opts: RegisterOptions): StoredRegion {
  const { cx, cz } = chunkFromAnchor(opts.anchor.x, opts.anchor.z);
  const key = regionKey(shortDimension(opts.dimension), cx, cz);

  const existing = regions.get(key);
  if (existing) return existing;

  const persisted = readRegionRecord(key);
  const dimensionId = persisted?.dimensionId ?? opts.dimension;
  const layout: RegionLayout = persisted?.layout ?? {
    chunkX: cx,
    chunkZ: cz,
    baseY: opts.baseY ?? DEFAULT_BASE_Y,
    maxLevels: opts.maxLevels ?? DEFAULT_MAX_LEVELS,
  };
  const invalid = validateLayout(layout);
  if (invalid) throw new Error(invalid);

  // 维度存在性校验（无效维度 getDimension 会抛错，提前给出中文提示）
  try {
    world.getDimension(dimensionId);
  } catch {
    throw new Error(`维度不存在或不可访问：${dimensionId}`);
  }

  const region = new StoredRegion(key, dimensionId, layout);
  if (!persisted) {
    writeRegionRecord(key, createRegionRecord(dimensionId, layout));
    appendRegionIndex(key);
  }
  region.ensureTickingArea();
  regions.set(key, region);
  return region;
}

/** 本上下文已注册的区域列表 */
export function listRegions(): StoredRegion[] {
  return [...regions.values()];
}

/** 按区域键取已注册区域（未注册返回 undefined） */
export function getRegion(key: string): StoredRegion | undefined {
  return regions.get(key);
}

/** 只读世界上的全部存储区域统计（无需本上下文注册，供其他模组管理读取） */
export function queryWorld(): RegionWorldInfo[] {
  return readRegionIndex()
    .map((key) => {
      const record = readRegionRecord(key);
      if (!record) return undefined;
      return regionStats(key, record.dimensionId, record.layout, record.meta);
    })
    .filter((s): s is RegionWorldInfo => s !== undefined);
}

/** 全库汇总（世界可见全部区域） */
export function totalStats(): { regionCount: number; totalCapacity: number; totalUsed: number } {
  const all = queryWorld();
  return {
    regionCount: all.length,
    totalCapacity: all.reduce((n, s) => n + s.capacity, 0),
    totalUsed: all.reduce((n, s) => n + s.used, 0),
  };
}

/** 对外公开的存储命名空间（register/查询/管理） */
export const ItemStorage = {
  register,
  listRegions,
  getRegion,
  queryWorld,
  totalStats,
};
