// ─── BotStore 端口（core 层） ───────────────────────────
// 假人持久化存储端口：mc 层实现（NBT 木桶阵列后端）与测试替身（内存 Map）共用。
// 泛型 TItem = 存储后端处理的物品类型：
//   - McBotStore      → ItemStack（真实物品，完整 NBT，潜影盒内容随物品保留）
//   - InMemoryBotStore → SerializedItemStack（测试替身，行为契约与旧 DP 后端一致）
//
// 物品存储不再使用 DynamicProperty JSON 视图，改为 nbt-data-storage 木桶阵列：
//   每假人一段固定槽位（bindingId × 41），背包格 i ↔ slot bindingId×41+i，
//   装备槽 j ↔ slot bindingId×41+36+j（见 core/storage/Binding.ts）。
// 记录（BotRecord）仍走单条 DP：mockplayer:players:<name>。

import type { BotRecord, SerializedItemStack } from "../model/Types";
import { INVENTORY_SIZE } from "../model/Types";

export interface BotStore<TItem = SerializedItemStack> {
  // ── 基础记录 ──
  saveRecord(record: BotRecord, silent?: boolean): void;
  loadRecord(name: string): BotRecord | undefined;
  /** 枚举全部记录，损坏条目跳过 */
  loadAllRecords(): BotRecord[];
  removeRecord(name: string): void;

  // ── 背包（每格 ↔ NBT 存储槽） ──
  /** 保存单个格子（传入 null 会清空对应槽） */
  saveSlot(name: string, slot: number, item: TItem | null): void;
  /** 保存全部背包格（空位传 null） */
  saveInventory(name: string, items: (TItem | null)[]): void;
  /** 批量保存指定背包格（对账式增量：只写变化的格子；单次记录读写） */
  saveSlots?(name: string, items: { slot: number; item: TItem | null }[]): void;
  /** 未绑定/无任何数据时返回 undefined（而非空数组），调用方据此判断是否需要恢复 */
  loadInventory(name: string): (TItem | null)[] | undefined;

  // ── 装备栏（每槽 ↔ NBT 存储槽） ──
  saveEquipSlot(name: string, slot: string, item: TItem | null): void;
  saveEquipment(name: string, equipment: Record<string, TItem | null>, silent?: boolean): void;
  /** 批量保存指定装备槽（对账式增量：只写变化的槽；单次记录读写） */
  saveEquipSlots?(name: string, items: { slot: string; item: TItem | null }[]): void;
  /** 返回 { head?, chest?, legs?, feet?, offhand? }，全空返回 undefined */
  loadEquipment(name: string): Record<string, TItem> | undefined;

  /** 删除假人的全部背包 + 装备槽数据（删除假人时调用） */
  removeInventory(name: string): void;

  /** 改名迁移绑定表（可选：binding 独立存储的后端实现；无独立绑定可省略） */
  renameBinding?(oldName: string, newName: string): void;
}

/** 内存后端（单测替身）：Map 直存，行为契约与 NBT 后端一致 */
export class InMemoryBotStore implements BotStore<SerializedItemStack> {
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

  saveSlots(name: string, items: { slot: number; item: SerializedItemStack | null }[]): void {
    for (const { slot, item } of items) {
      this.saveSlot(name, slot, item ?? null);
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

  saveEquipSlots(name: string, items: { slot: string; item: SerializedItemStack | null }[]): void {
    for (const { slot, item } of items) {
      this.saveEquipSlot(name, slot, item ?? null);
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

  /** 改名迁移：背包/装备槽 key 前缀随名迁移（行为与 NBT 后端绑定迁移一致） */
  renameBinding(oldName: string, newName: string): void {
    for (const key of [...this.slots.keys()]) {
      if (key.startsWith(`${oldName}:inv:`) || key.startsWith(`${oldName}:equip:`)) {
        this.slots.set(newName + key.slice(oldName.length), this.slots.get(key)!);
        this.slots.delete(key);
      }
    }
  }
}
