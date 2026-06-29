// ─── 全局状态 + 持久化 ────────────────────────────────────

import { world } from "@minecraft/server";
import { BotRecord, DP_PREFIX, SerializedItemStack } from "./types";

// ─── 全局状态 ──────────────────────────────────────────────

export const botRegistry: Map<string, BotRecord> = new Map();
export let botCounter = 1;

export function generateBotName(): string {
  const n = botCounter++;
  return `sim${String(n).padStart(3, "0")}`;
}

// ─── 基础记录持久化 ────────────────────────────────────────

function getDPKey(name: string): string {
  return `${DP_PREFIX}${name}`;
}

export function saveBotRecord(record: BotRecord): void {
  try {
    world.setDynamicProperty(getDPKey(record.name), JSON.stringify(record));
  } catch (e: any) {
    console.warn(`[MockPlayer] 保存假人 ${record.name} 失败: ${e.message}`);
  }
}

export function loadBotRecord(name: string): BotRecord | undefined {
  const value = world.getDynamicProperty(getDPKey(name));
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as BotRecord;
  } catch {
    return undefined;
  }
}

export function loadAllBotRecords(): BotRecord[] {
  const ids = world.getDynamicPropertyIds();
  const records: BotRecord[] = [];
  for (const id of ids) {
    if (!id.startsWith(DP_PREFIX)) continue;
    // 跳过背包/装备子 key
    if (id.includes(":inv:") || id.includes(":equip:")) continue;
    const value = world.getDynamicProperty(id);
    if (typeof value !== "string") continue;
    try {
      records.push(JSON.parse(value) as BotRecord);
    } catch {
      // 损坏数据跳过
    }
  }
  return records;
}

export function removeBotRecord(name: string): void {
  world.setDynamicProperty(getDPKey(name), undefined);
}

// ─── 背包持久化（每格独立 key，避免 32KB 上限）────────────

const INV_PREFIX = ":inv:";

/** 保存单个背包格子 */
export function saveBotSlot(name: string, slot: number, item: SerializedItemStack | null): void {
  const key = `${DP_PREFIX}${name}${INV_PREFIX}${slot}`;
  if (item) {
    world.setDynamicProperty(key, JSON.stringify(item));
  } else {
    world.setDynamicProperty(key, undefined);
  }
}

/** 保存假人全部 36 格背包 */
export function saveBotInventory(name: string, items: (SerializedItemStack | null)[]): void {
  for (let i = 0; i < items.length && i < 36; i++) {
    saveBotSlot(name, i, items[i]);
  }
}

/** 加载假人全部 36 格背包，返回 36 格数组（null = 空位） */
export function loadBotInventory(name: string): (SerializedItemStack | null)[] | undefined {
  const ids = world.getDynamicPropertyIds();
  const prefix = `${DP_PREFIX}${name}${INV_PREFIX}`;
  const result: (SerializedItemStack | null)[] = new Array(36).fill(null);
  let found = false;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const slotStr = id.slice(prefix.length);
    const slot = parseInt(slotStr);
    if (isNaN(slot) || slot < 0 || slot > 35) continue;
    const value = world.getDynamicProperty(id);
    if (typeof value === "string") {
      try {
        result[slot] = JSON.parse(value) as SerializedItemStack;
        found = true;
      } catch {
        // 损坏数据跳过
      }
    }
  }
  return found ? result : undefined;
}

// ─── 装备栏持久化 ──────────────────────────────────────────

const EQUIP_PREFIX = ":equip:";

/** 装备槽位名列表 */
export const EQUIP_SLOTS = ["head", "chest", "legs", "feet", "offhand"] as const;

/** 保存单个装备槽 */
export function saveBotEquipSlot(name: string, slot: string, item: SerializedItemStack | null): void {
  const key = `${DP_PREFIX}${name}${EQUIP_PREFIX}${slot}`;
  if (item) {
    world.setDynamicProperty(key, JSON.stringify(item));
  } else {
    world.setDynamicProperty(key, undefined);
  }
}

/** 保存全部装备栏 */
export function saveBotEquipment(
  name: string,
  equipment: Record<string, SerializedItemStack | null>
): void {
  for (const [slot, item] of Object.entries(equipment)) {
    saveBotEquipSlot(name, slot, item);
  }
}

/** 加载全部装备栏 */
export function loadBotEquipment(name: string): Record<string, SerializedItemStack> | undefined {
  const ids = world.getDynamicPropertyIds();
  const prefix = `${DP_PREFIX}${name}${EQUIP_PREFIX}`;
  const result: Record<string, SerializedItemStack> = {};
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const slot = id.slice(prefix.length);
    const value = world.getDynamicProperty(id);
    if (typeof value === "string") {
      try {
        result[slot] = JSON.parse(value) as SerializedItemStack;
      } catch {
        // 损坏数据跳过
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** 删除假人的全部背包 + 装备数据 */
export function removeBotInventory(name: string): void {
  const ids = world.getDynamicPropertyIds();
  const baseKey = `${DP_PREFIX}${name}`;
  for (const id of ids) {
    if (id.startsWith(baseKey + INV_PREFIX) || id.startsWith(baseKey + EQUIP_PREFIX)) {
      world.setDynamicProperty(id, undefined);
    }
  }
}
