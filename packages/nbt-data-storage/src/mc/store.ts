// ── 区域持久化（DynamicProperty 直存，mc 适配层） ──────────────────────
// DP 键约定：
//   `nds:regions`                   → 全局区域索引（JSON string[]，供其他模组只读管理）
//   `nds:item:{区域键}`              → 区域主记录（layout + dimensionId + meta：v3 仅 barrelCount）
//   `nds:item:{区域键}:usage:{层}`  → 该层桶水位（已物化桶的占用计数数组，
//                                     每桶一个 0..27 数字，满层 256 个 ≈ 640B）
// 区域键形如 `the_end:0:-64`，即主记录 DP 键的后缀。
// **桶水位设计**（v3，取代 v2 空洞池）：空槽不做任何登记——分配时桶内探测
// 容器真值。因此单值体量从"每层 6912 个 ID"降为"每层 256 个计数"，
// 从根上规避 DynamicProperty 单值 32KB 上限（无需分片）。
// DP 是软状态：丢失时从世界真值自愈，不影响已存物品安全。
import { world } from "@minecraft/server";
import { parseRegionRecord, serializeRegionRecord, type PersistedRegion } from "../core/record";
import { BARREL_SLOTS } from "../core/layout";

/** 全局区域索引 DP 键 */
export const REGION_INDEX_KEY = "nds:regions";

/** 区域记录 DP 键（后缀即区域键） */
export function regionDpKey(key: string): string {
  return `nds:item:${key}`;
}

/** 某层桶水位 DP 键（已物化桶的占用计数数组） */
export function levelUsageDpKey(key: string, level: number): string {
  return `${regionDpKey(key)}:usage:${level}`;
}

/**
 * 读取区域记录；无/损坏返回 undefined。
 * @param opts.throwOnError 世界未完全加载等异常时**抛出**而非当作"无记录"
 *   （注册路径用：防止早期执行把真实记录误判为不存在而覆盖/建错误布局句柄）
 */
export function readRegionRecord(key: string, opts: { throwOnError?: boolean } = {}): PersistedRegion | undefined {
  try {
    const value = world.getDynamicProperty(regionDpKey(key));
    if (typeof value === "string") return parseRegionRecord(value);
    return undefined;
  } catch (e) {
    if (opts.throwOnError)
      throw new Error(`存储区域记录读取失败（世界可能尚未完全加载）：${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/** 写区域记录（事件驱动写穿，无定时 flush） */
export function writeRegionRecord(key: string, record: PersistedRegion): void {
  try {
    world.setDynamicProperty(regionDpKey(key), serializeRegionRecord(record));
  } catch (e) {
    console.warn(`[nbt-data-storage] 持久化区域 ${key} 失败`, e);
  }
}

/** 解析一层桶水位 JSON；损坏/非法元素过滤（0..27 整数） */
function parseUsage(json: string): number[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= BARREL_SLOTS
      );
    }
  } catch {
    /* 损坏键：视为无数据 */
  }
  return [];
}

/** 读取某层桶水位（已物化桶的占用计数数组）；无/损坏返回空数组 */
export function readLevelUsage(key: string, level: number): number[] {
  try {
    const value = world.getDynamicProperty(levelUsageDpKey(key, level));
    if (typeof value === "string") return parseUsage(value);
    return [];
  } catch {
    return [];
  }
}

/** 写某层桶水位；空数组 = 该层无物化桶 → 真正删除键（不留 `"[]"` 残留） */
export function writeLevelUsage(key: string, level: number, usage: number[]): void {
  try {
    if (usage.length === 0) {
      world.setDynamicProperty(levelUsageDpKey(key, level), undefined); // 删键
      return;
    }
    world.setDynamicProperty(levelUsageDpKey(key, level), JSON.stringify(usage));
  } catch (e) {
    console.warn(`[nbt-data-storage] 持久化桶水位 ${levelUsageDpKey(key, level)} 失败`, e);
  }
}

/** 读取全局区域索引 */
export function readRegionIndex(): string[] {
  try {
    const value = world.getDynamicProperty(REGION_INDEX_KEY);
    if (typeof value === "string") {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === "string");
      }
    }
    return [];
  } catch {
    return [];
  }
}

/** 追加区域键到索引（幂等） */
export function appendRegionIndex(key: string): void {
  try {
    const index = readRegionIndex();
    if (index.includes(key)) return;
    index.push(key);
    world.setDynamicProperty(REGION_INDEX_KEY, JSON.stringify(index));
  } catch {
    /* 索引是软状态，失败不影响存储 */
  }
}