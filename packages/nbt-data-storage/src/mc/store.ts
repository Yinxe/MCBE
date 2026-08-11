// ── 区域持久化（DynamicProperty 直存，mc 适配层） ──────────────────────
// DP 键约定：
//   `nds:regions`             → 全局区域索引（JSON string[]，供其他模组只读管理）
//   `nds:item:{区域键}`        → 该区域记录（layout + dimensionId + meta 合一）
// 区域键形如 `the_end:0:-64`，即 DP 键的后缀，两者一一对应。
// DP 是软状态：丢失时从世界真值自愈，不影响已存物品安全。
import { world } from "@minecraft/server";
import { parseRegionRecord, serializeRegionRecord, type PersistedRegion } from "../core/record";

/** 全局区域索引 DP 键 */
export const REGION_INDEX_KEY = "nds:regions";

/** 区域记录 DP 键（后缀即区域键） */
export function regionDpKey(key: string): string {
  return `nds:item:${key}`;
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
