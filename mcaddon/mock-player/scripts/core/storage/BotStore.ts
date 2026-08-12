// ─── BotStore 端口（core 层） ───────────────────────────
// 假人持久化存储端口：mc 层实现（DynamicProperty 后端）与测试替身（内存 Map）共用。
//
// DP key 设计（避免 32KB 上限）：
//   mockplayer:players:<name>           — BotRecord（位置/标签/经验等）
//   mockplayer:players:<name>:inv:<N>   — 背包第 N 格（slot 0-35）
//   mockplayer:players:<name>:equip:<X> — 装备槽（head/chest/legs/feet/offhand）

import type { BotRecord, SerializedItemStack } from "../model/Types";
import { INVENTORY_SIZE } from "../model/Types";

export interface BotStore {
  // ── 基础记录 ──
  saveRecord(record: BotRecord, silent?: boolean): void;
  loadRecord(name: string): BotRecord | undefined;
  /** 枚举全部记录（跳过 :inv: / :equip: 子 key），损坏条目跳过 */
  loadAllRecords(): BotRecord[];
  removeRecord(name: string): void;

  // ── 背包（每格独立 key） ──
  /** 保存单个格子（传入 null 或 undefined 会删除该 key） */
  saveSlot(name: string, slot: number, item: SerializedItemStack | null): void;
  /** 保存全部背包格（空位删除 key，避免数据膨胀） */
  saveInventory(name: string, items: (SerializedItemStack | null)[]): void;
  /** 未找到任何 key 时返回 undefined（而非空数组），调用方据此判断是否需要恢复 */
  loadInventory(name: string): (SerializedItemStack | null)[] | undefined;

  // ── 装备栏（每槽独立 key） ──
  saveEquipSlot(name: string, slot: string, item: SerializedItemStack | null): void;
  saveEquipment(name: string, equipment: Record<string, SerializedItemStack | null>, silent?: boolean): void;
  /** 返回 { head?, chest?, legs?, feet?, offhand? }，全空返回 undefined */
  loadEquipment(name: string): Record<string, SerializedItemStack> | undefined;

  /** 删除假人的全部背包 + 装备数据（删除假人时调用） */
  removeInventory(name: string): void;
}

/** 内存后端（单测替身）：Map 直存，行为与 DynamicProperty 后端一致 */
export class InMemoryBotStore implements BotStore {
  readonly records = new Map<string, BotRecord>();
  readonly slots = new Map<string, SerializedItemStack | null>();
  /** 记录写入次数（断言 saveRecord 触发次数用） */
  recordWrites = 0;

  private slotKey(name: string, slot: number): string {
    return `${name}:inv:${slot}`;
  }

  private equipKey(name: string, slot: string): string {
    return `${name}:equip:${slot}`;
  }

  saveRecord(record: BotRecord, _silent?: boolean): void {
    this.records.set(record.name, { ...record });
    this.recordWrites++;
  }

  loadRecord(name: string): BotRecord | undefined {
    const r = this.records.get(name);
    return r ? { ...r } : undefined;
  }

  loadAllRecords(): BotRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  removeRecord(name: string): void {
    this.records.delete(name);
  }

  saveSlot(name: string, slot: number, item: SerializedItemStack | null): void {
    const key = this.slotKey(name, slot);
    if (item) {
      this.slots.set(key, { ...item, container: item.container?.map((c) => (c ? { ...c } : null)) });
    } else {
      this.slots.delete(key);
    }
  }

  saveInventory(name: string, items: (SerializedItemStack | null)[]): void {
    for (let i = 0; i < items.length; i++) {
      this.saveSlot(name, i, items[i] ?? null);
    }
  }

  loadInventory(name: string): (SerializedItemStack | null)[] | undefined {
    const result: (SerializedItemStack | null)[] = [];
    let found = false;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const item = this.slots.get(this.slotKey(name, i));
      if (item) {
        result.push({ ...item });
        found = true;
      } else {
        result.push(null);
      }
    }
    return found ? result : undefined;
  }

  saveEquipSlot(name: string, slot: string, item: SerializedItemStack | null): void {
    const key = this.equipKey(name, slot);
    if (item) {
      this.slots.set(key, { ...item });
    } else {
      this.slots.delete(key);
    }
  }

  saveEquipment(name: string, equipment: Record<string, SerializedItemStack | null>, _silent?: boolean): void {
    for (const [slot, item] of Object.entries(equipment)) {
      this.saveEquipSlot(name, slot, item);
    }
  }

  loadEquipment(name: string): Record<string, SerializedItemStack> | undefined {
    const result: Record<string, SerializedItemStack> = {};
    for (const [key, item] of this.slots) {
      if (key.startsWith(`${name}:equip:`) && item) {
        result[key.slice(name.length + 7)] = { ...item };
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  removeInventory(name: string): void {
    for (const key of [...this.slots.keys()]) {
      if (key.startsWith(`${name}:inv:`) || key.startsWith(`${name}:equip:`)) {
        this.slots.delete(key);
      }
    }
  }
}