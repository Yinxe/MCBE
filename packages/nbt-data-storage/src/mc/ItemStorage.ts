// ── ItemStorage：存储区域注册表（mc 适配层，对外唯一入口） ──────────────
// 模组以 `ItemStorage.register({ dimension, anchor, baseY })` 注册一个
// "区块锚定的全木桶阵列"（纵向固定 64 层，无需传配置；不够再注册新集群）：
//   - 锚点任意坐标 → 所在区块即存储地址（同维度同区块 → 同一阵列 → 多模组共享）
//   - 世界已有该区域持久化记录（别的模组先建）→ 采纳其布局与维度，共享数据
//   - 全新区域 → 写持久化记录 + ticking area 常加载 + 追加全局索引
// 存储最小单位 = 每个木桶格子的 ItemStack（完整 NBT）；put 成功返回取物凭据
// `{ regionId, slotId }`，之后凭凭据 O(1) 取物（getRegion/ref → 解码 → 秒定位）。
import { world } from "@minecraft/server";
import type { ItemStack, Vector3 } from "@minecraft/server";
import { chunkFromAnchor, validateLayout } from "../core/layout";
import { regionId, shortDimension, type StoredRef } from "../core/keys";
import { createRegionRecord } from "../core/record";
import { assertLayoutConsistent, resolveRegistration } from "../core/region";
import { regionStats, type RegionStats } from "../core/stats";
import { StoredRegion } from "./StoredRegion";
import { ItemStorageEvents } from "./events";
import { appendRegionIndex, readLevelUsage, readRegionIndex, readRegionRecord, writeRegionRecord } from "./store";

/** 注册参数：维度 + 锚点坐标（决定区块地址），可选 baseY（层数固定 64） */
export interface RegisterOptions {
  /** 完整维度 ID（推荐 `minecraft:the_end`） */
  dimension: string;
  /** 锚点坐标：任意坐标 → 所在区块为存储地址 */
  anchor: Vector3;
  /** 最底层木桶 Y（默认 120；仅首个注册该区块的模组生效） */
  baseY?: number;
  /** 每桶可分配槽位上限 0..27（仅测试渠道 registerTest 使用，默认 27 = 全部可用） */
  slotPerBarrel?: number;
  /** 纵向层数上限 1..64（仅测试渠道 registerTest 使用，默认 64） */
  maxLevels?: number;
  /** ⚠️ 测试区域特权标记（仅 registerTest 内部置 true；正式 register 不传） */
  test?: boolean;
}

/** 世界视角的区域统计（只读，供其他模组管理读取） */
export type RegionWorldInfo = RegionStats;

/** 本上下文（本模组脚本）已注册的区域，按区域 ID 索引 */
const regions = new Map<string, StoredRegion>();

/**
 * 注册/获取一个存储区域（幂等）。
 * - 已在本上下文注册 → 直接返回既有实例；
 * - 世界已有该区域记录（其他模组先建）→ 采纳其维度与布局（布局参数不一致会抛错拒绝），共享同一阵列；
 * - 全新 → 按传入参数创建并持久化。
 *
 * @throws 维度无效 / 布局非法 / 布局参数与既有记录不一致时抛中文错误
 */
export function register(opts: RegisterOptions): StoredRegion {
  return registerWith(opts);
}

/**
 * ⚠️ 仅测试/演示用（如 nds-demo 容量模拟）：注册一个布局可覆盖的存储区域。
 * 比 `register` 多接受 `slotPerBarrel`（每桶可用槽数 1..27）与 `maxLevels`（层数 1..64），
 * 用于快速模拟满容量 / 见证扩容。**正式模组请用 `register`**（不传新参数时行为与 register 完全一致）。
 *
 * ID 语义恒定：解码永远按 27 槽/桶，slotPerBarrel 只限制每桶可分配槽数（分配跳过超限槽），
 * 已存物品的 ID 永不漂移。同一区块布局参数与既有记录不一致时抛错（拒绝混用），请更换锚点开新区块。
 */
export function registerTest(opts: RegisterOptions): StoredRegion {
  return registerWith({ ...opts, test: true });
}

/** register / registerTest 共用实现 */
function registerWith(opts: RegisterOptions): StoredRegion {
  const { cx, cz } = chunkFromAnchor(opts.anchor.x, opts.anchor.z);
  const id = regionId(shortDimension(opts.dimension), cx, cz);

  const existing = regions.get(id);
  if (existing) {
    // 缓存命中也必须校验布局一致性：否则测试渠道改参数后仍拿旧布局句柄继续用
    // （新物品会按旧布局分配，看起来"不扩容/写入旧桶末尾"），必须拒绝并提示换锚点
    assertLayoutConsistent(
      existing.layout,
      {
        dimensionId: opts.dimension,
        baseY: opts.baseY,
        maxLevels: opts.maxLevels,
        slotPerBarrel: opts.slotPerBarrel,
        test: opts.test,
      },
      cx,
      cz
    );
    return existing;
  }

  // 已有持久化记录 → 校验一致性并采纳其维度/布局（后注册者传的 baseY 等被忽略）；
  // 否则按传入参数新建（resolveRegistration 内部对不一致的 slotPerBarrel/maxLevels 抛错）
  // throwOnError：世界未完全加载时读失败 → 抛出（绝不把真实记录误判为"无记录"而覆盖）
  const persisted = readRegionRecord(id, { throwOnError: true });
  const { dimensionId, layout } = resolveRegistration(
    persisted,
    {
      dimensionId: opts.dimension,
      baseY: opts.baseY,
      maxLevels: opts.maxLevels,
      slotPerBarrel: opts.slotPerBarrel,
      test: opts.test,
    },
    { cx, cz }
  );
  const invalid = validateLayout(layout, opts.dimension);
  if (invalid) throw new Error(invalid);

  // 维度存在性校验（无效维度 getDimension 会抛错，提前给出中文提示）
  try {
    world.getDimension(dimensionId);
  } catch {
    throw new Error(`维度不存在或不可访问：${dimensionId}`);
  }

  const region = new StoredRegion(id, dimensionId, layout);
  if (!persisted) {
    writeRegionRecord(id, createRegionRecord(dimensionId, layout));
    appendRegionIndex(id);
  }
  region.ensureTickingArea();
  regions.set(id, region);
  return region;
}

/**
 * 按区域 ID 取/采纳存储区域（幂等；无需锚点）。
 * 未在本上下文注册但世界有记录时，从持久化记录还原出区域句柄（跨模组用凭据取物）。
 * 未注册且无记录返回 undefined。
 */
export function getRegion(regionId: string): StoredRegion | undefined {
  const existing = regions.get(regionId);
  if (existing) return existing;
  const record = readRegionRecord(regionId);
  if (!record) return undefined;
  const { dimensionId, layout } = resolveRegistration(
    record,
    // 采纳路径只是还原既有记录的句柄，**不是注册**：不写记录、不决定布局，
    // 必须带 test:true 才不会触发"正式渠道注册被拒"（否则 demo 自己的测试区域
    // 一探测就抛错，导致"存储未初始化"）；正式渠道防线只在 registerWith 生效。
    { dimensionId: record.dimensionId, test: true },
    { cx: record.layout.chunkX, cz: record.layout.chunkZ }
  );
  const region = new StoredRegion(regionId, dimensionId, layout);
  region.ensureTickingArea();
  regions.set(regionId, region);
  return region;
}

/** 本上下文已注册的区域列表 */
export function listRegions(): StoredRegion[] {
  return [...regions.values()];
}

/** 按取物凭据 O(1) 取物（只读不回收；跨模组可用） */
export function get(ref: StoredRef): ItemStack | undefined {
  return getRegion(ref.regionId)?.get(ref.slotId);
}

/** 按取物凭据 O(1) 取走（读出 + 清空 + 回收空洞；跨模组可用） */
export function take(ref: StoredRef): ItemStack | undefined {
  return getRegion(ref.regionId)?.take(ref.slotId);
}

/** 只读世界上的全部存储区域统计（无需本上下文注册，供其他模组管理读取） */
export function queryWorld(): RegionWorldInfo[] {
  return readRegionIndex()
    .map((id) => {
      const record = readRegionRecord(id);
      if (!record) return undefined;
      return regionStats(
        id,
        record.dimensionId,
        record.layout,
        record.meta,
        (level) => readLevelUsage(id, level)
      );
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

/** 对外公开的存储命名空间（注册/凭据取物/管理/事件） */
export const ItemStorage = {
  register,
  registerTest,
  getRegion,
  listRegions,
  get,
  take,
  queryWorld,
  totalStats,
  events: ItemStorageEvents,
};
