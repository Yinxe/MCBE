// ─── 全局状态 + 持久化 ────────────────────────────────

import { world } from "@minecraft/server";
import { BotRecord, DP_PREFIX } from "./types";

// ─── 全局状态 ──────────────────────────────────────────

export const botRegistry: Map<string, BotRecord> = new Map();
export let botCounter = 1;

export function generateBotName(): string {
  const n = botCounter++;
  return `sim${String(n).padStart(3, "0")}`;
}

// ─── 持久化 ────────────────────────────────────────────

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
