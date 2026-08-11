// ── 区域持久化（DynamicProperty 直存，mc 适配层） ──────────────────────
// DP 键约定：
//   `nds:regions`                 → 全局区域索引（JSON string[]，供其他模组只读管理）
//   `nds:item:{区域键}`            → 区域主记录（layout + dimensionId + meta：水印/洞索引/洞数）
//   `nds:item:{区域键}:pool:{层}`  → 该层空洞池（JSON level-local 索引数组，单值 ≤ 6912 条）
// 区域键形如 `the_end:0:-64`，即主记录 DP 键的后缀。
// 空洞按层分键存储：即使层数很多（如 64 层），每个 DP 单值也始终 ≤ 一层槽数，
// 从根上规避 DynamicProperty 单值大小上限。
// DP 是软状态：丢失时从世界真值自愈，不影响已存物品安全。
import { world } from "@minecraft/server";
import { parseRegionRecord, serializeRegionRecord, type PersistedRegion } from "../core/record";

/** 全局区域索引 DP 键 */
export const REGION_INDEX_KEY = "nds:regions";

/** 区域记录 DP 键（后缀即区域键） */
export function regionDpKey(key: string): string {
  return `nds:item:${key}`;
}

/** 某层空洞池 DP 键（level-local 索引） */
export function levelPoolDpKey(key: string, level: number): string {
  return `${regionDpKey(key)}:pool:${level}`;
}

/** 读取区域记录；无/损坏返回 undefined */
export function readRegionRecord(key: string): PersistedRegion | undefined {
  try {
    const value = world.getDynamicProperty(regionDpKey(key));
    if (typeof value === "string") return parseRegionRecord(value);
    return undefined;
  } catch {
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

/** 读取某层空洞池（level-local 索引）；无/损坏返回空数组 */
export function readLevelPool(key: string, level: number): number[] {
  try {
    const value = world.getDynamicProperty(levelPoolDpKey(key, level));
    if (typeof value === "string") {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0);
      }
    }
    return [];
  } catch {
    return [];
  }
}

/** 写某层空洞池（含空数组：层已无洞时清掉数据本身） */
export function writeLevelPool(key: string, level: number, locals: number[]): void {
  try {
    world.setDynamicProperty(levelPoolDpKey(key, level), JSON.stringify(locals));
  } catch (e) {
    console.warn(`[nbt-data-storage] 持久化空洞池 ${levelPoolDpKey(key, level)} 失败`, e);
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
