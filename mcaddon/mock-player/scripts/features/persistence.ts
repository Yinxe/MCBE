// ─── 全局状态 + 持久化 ────────────────────────────────────
// 负责 botRegistry 内存状态 + DynamicProperty 读写
//
// key 设计（避免 32KB 上限）：
//   mockplayer:players:<name>           — BotRecord（位置/标签/经验等）
//   mockplayer:players:<name>:inv:<N>   — 背包第 N 格（slot 0-35）
//   mockplayer:players:<name>:equip:<X> — 装备槽（head/chest/legs/feet/offhand）
//
// 载入时用 getDynamicPropertyIds() 枚举所有 key 按前缀过滤
// 清理时只删 inv: 和 equip: 子 key，不动主 record

import { world } from "@minecraft/server";
import { BotRecord, DP_PREFIX, SerializedItemStack } from "./types";

// ─── 全局状态 ──────────────────────────────────────────────

/** 内存中的假人注册表（key = 假人名），世界重启后由 loadAllBotRecords 填充 */
export const botRegistry: Map<string, BotRecord> = new Map();

/**
 * 标记哪些假人已完成背包/装备/经验恢复
 *
 * ⚠️ 高危漏洞防护：
 *   spawnSimulatedPlayer 生成的假人自带空背包。
 *   如果在 playerJoin 恢复完成之前触发保存（如 100tick 周期、playerLeave 等），
 *   空背包数据会覆盖持久化的真实数据，造成背包永久清空。
 *
 *   此 Set 记录已完成恢复的假人名，saveBotFullState 遇到未恢复的假人直接跳过保存。
 *   世界重启后 Set 自动清空（内存数据），每个假人重新走恢复流程后重新标记。
 *
 *   标记时机：playerJoin 恢复完成后 → markBotRestored
 *   检查时机：saveBotFullState 开头 → isBotRestored
 *   清理时机：deleteBot → removeBotRestored
 */
const restoredBots: Set<string> = new Set();

export function markBotRestored(name: string): void {
  restoredBots.add(name);
  console.warn(`[MockPlayer] ✅ 恢复完成 ${name}——禁止空背包覆写`);
}

export function isBotRestored(name: string): boolean {
  return restoredBots.has(name);
}

export function removeBotRestored(name: string): void {
  restoredBots.delete(name);
  console.warn(`[MockPlayer] 清除恢复标记 ${name}`);
}

/** 自动生成假人名的计数器（sim001、sim002…） */
export let botCounter = 1;

export function generateBotName(): string {
  const n = botCounter++;
  return `sim${String(n).padStart(3, "0")}`;
}

// ─── 基础记录持久化 ────────────────────────────────────────
// BotRecord 存到单条 DynamicProperty，上限 32KB（不含背包/装备）

function getDPKey(name: string): string {
  return `${DP_PREFIX}${name}`;
}

export function saveBotRecord(record: BotRecord): void {
  try {
    world.setDynamicProperty(getDPKey(record.name), JSON.stringify(record));
    console.warn(`[MockPlayer] 记录保存 ${record.name}（在线=${record.online} 死亡=${record.death} 经验Lv=${record.experience.level}）`);
  } catch (e: any) {
    console.warn(`[MockPlayer] 保存假人 ${record.name} 失败: ${e.message}`);
  }
}

export function loadBotRecord(name: string): BotRecord | undefined {
  const value = world.getDynamicProperty(getDPKey(name));
  if (typeof value !== "string") return undefined;
  try {
    const record = JSON.parse(value) as BotRecord;
    console.warn(`[MockPlayer] 加载单条记录 ${name}`);
    return record;
  } catch {
    console.warn(`[MockPlayer] 加载记录 ${name} 损坏`);
    return undefined;
  }
}

/**
 * 世界重启时加载所有假人记录
 * 注意：需要跳过 :inv: 和 :equip: 子 key，它们由独立的 loadBotInventory / loadBotEquipment 加载
 */
export function loadAllBotRecords(): BotRecord[] {
  const ids = world.getDynamicPropertyIds();
  const records: BotRecord[] = [];
  for (const id of ids) {
    if (!id.startsWith(DP_PREFIX)) continue;
    // 跳过背包/装备子 key（以 :inv: 或 :equip: 结尾的 segment）
    if (id.includes(":inv:") || id.includes(":equip:")) continue;
    const value = world.getDynamicProperty(id);
    if (typeof value !== "string") continue;
    try {
      records.push(JSON.parse(value) as BotRecord);
    } catch {
      console.warn(`[MockPlayer] 加载记录 ${id} 损坏已跳过`);
    }
  }
  console.warn(`[MockPlayer] 世界加载恢复 ${records.length} 个假人记录`);
  return records;
}

export function removeBotRecord(name: string): void {
  world.setDynamicProperty(getDPKey(name), undefined);
  console.warn(`[MockPlayer] 删除记录 ${name}`);
}

// ─── 背包持久化（每格独立 key，避免 32KB 上限）────────────
//
// 每个格子一条 DynamicProperty，key 格式：
//   mockplayer:players:<name>:inv:<slot>
// slot 0-8 = 快捷栏，9-35 = 背包
// 空位存 undefined（即删除 key），避免数据膨胀
//
// 使用 playerInventoryItemChange 事件实时保存单格变化
// 离线/死亡时批量保存全部 36 格

const INV_PREFIX = ":inv:";

/** 保存单个背包格子（传入 null 或 undefined 会删除该 key） */
export function saveBotSlot(name: string, slot: number, item: SerializedItemStack | null): void {
  const key = `${DP_PREFIX}${name}${INV_PREFIX}${slot}`;
  if (item) {
    world.setDynamicProperty(key, JSON.stringify(item));
  } else {
    // 空位删除 key，避免无用数据累积
    world.setDynamicProperty(key, undefined);
  }
}

/** 保存假人全部 36 格背包 */
export function saveBotInventory(name: string, items: (SerializedItemStack | null)[]): void {
  const nonEmpty = items.filter((i) => i !== null).length;
  for (let i = 0; i < items.length && i < 36; i++) {
    saveBotSlot(name, i, items[i]);
  }
  console.warn(`[MockPlayer] 背包保存 ${name}——${nonEmpty}/${items.length} 格`);
}

/**
 * 加载假人全部 36 格背包
 * 枚举所有 <name>:inv: 前缀的 key，按 slot 填入数组
 * 未找到任何 key 时返回 undefined（而非空数组），调用方据此判断是否需要恢复
 */
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
        console.warn(`[MockPlayer] 加载背包 ${name} slot ${slot} 损坏`);
      }
    }
  }
  const count = result.filter((i) => i !== null).length;
  if (found) console.warn(`[MockPlayer] 背包加载 ${name}——${count}/36 格`);
  return found ? result : undefined;
}

// ─── 装备栏持久化 ──────────────────────────────────────────
//
// 装备槽没有变化事件，依赖 100tick 周期保存 + 离线/死亡兜底
// key 格式：mockplayer:players:<name>:equip:<slotName>
//
// ⚠️ 注意：world.getEntity 在 playerLeave 中可能已不可访问
// 所以装备在 entityDie 中保存最可靠

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
  const slots = Object.keys(equipment);
  const nonEmpty = Object.values(equipment).filter((i) => i !== null).length;
  for (const [slot, item] of Object.entries(equipment)) {
    saveBotEquipSlot(name, slot, item);
  }
  console.warn(`[MockPlayer] 装备保存 ${name}——${nonEmpty}/${slots.length} 槽`);
}

/** 加载全部装备栏，返回 { head?, chest?, legs?, feet?, offhand? } */
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
        console.warn(`[MockPlayer] 加载装备 ${name} ${slot} 损坏`);
      }
    }
  }
  const count = Object.keys(result).length;
  if (count > 0) console.warn(`[MockPlayer] 装备加载 ${name}——${count}/5 槽`);
  return count > 0 ? result : undefined;
}

/** 删除假人的全部背包 + 装备数据（删除假人时调用） */
export function removeBotInventory(name: string): void {
  const ids = world.getDynamicPropertyIds();
  const baseKey = `${DP_PREFIX}${name}`;
  for (const id of ids) {
    if (id.startsWith(baseKey + INV_PREFIX) || id.startsWith(baseKey + EQUIP_PREFIX)) {
      world.setDynamicProperty(id, undefined);
    }
  }
}
