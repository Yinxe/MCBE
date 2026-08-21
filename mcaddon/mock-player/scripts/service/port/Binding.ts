// ─── NBT 存储绑定表辅助（core 层纯逻辑） ────────────────
// 假人背包格/装备槽 ↔ nbt-data-storage 槽位（slotId）的映射操作。
// 槽位由库的 `put` 惰性分配（复用分配/回收语义，绝不与他人冲突）。
// **key-value 对象结构**（无 key = 未绑定）：稀疏存储、不受数组长度约束、
// JSON 紧凑。绑定表独立持久化（McBotStore 管理，与 BotRecord 解耦）。
// 零 @minecraft 依赖，可 node 单测。

import { INVENTORY_SIZE } from "../../rules/Types";
import type { StorageBinding } from "../../rules/Types";

/** 新建空绑定表（全部槽位未绑定） */
export function createBinding(regionId: string): StorageBinding {
  return { regionId, inv: {}, equip: {} };
}

/** 背包格 → 绑定 slotId（undefined = 未绑定） */
export function boundSlotId(binding: StorageBinding | undefined, slot: number): number | undefined {
  return binding?.inv[String(slot)];
}

/** 装备槽名 → 绑定 slotId（undefined = 未绑定） */
export function boundEquipSlotId(binding: StorageBinding | undefined, slotName: string): number | undefined {
  return binding?.equip[slotName];
}

/** 写入背包格绑定（slotId 必须是非负整数；slot 越界抛错） */
export function bindSlot(binding: StorageBinding, slot: number, slotId: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= INVENTORY_SIZE) {
    throw new Error(`背包格越界: ${slot}（0-${INVENTORY_SIZE - 1}）`);
  }
  if (!Number.isInteger(slotId) || slotId < 0) {
    throw new Error(`非法 slotId: ${slotId}`);
  }
  binding.inv[String(slot)] = slotId;
}

/** 写入装备槽绑定（slotId 必须是非负整数） */
export function bindEquipSlot(binding: StorageBinding, slotName: string, slotId: number): void {
  if (!Number.isInteger(slotId) || slotId < 0) {
    throw new Error(`非法 slotId: ${slotId}`);
  }
  binding.equip[slotName] = slotId;
}

/** 清空背包格绑定（未绑定时无操作） */
export function unbindSlot(binding: StorageBinding, slot: number): void {
  delete binding.inv[String(slot)];
}

/** 清空装备槽绑定（未绑定时无操作） */
export function unbindEquipSlot(binding: StorageBinding, slotName: string): void {
  delete binding.equip[slotName];
}

/** 全部已绑定 slotId（删除假人时逐个 take 释放用） */
export function allBoundSlotIds(binding: StorageBinding): number[] {
  return [...Object.values(binding.inv), ...Object.values(binding.equip)];
}

/** 是否任何槽位已绑定（有存档判定） */
export function hasAnyBinding(binding: StorageBinding | undefined): boolean {
  if (!binding) return false;
  return Object.keys(binding.inv).length > 0 || Object.keys(binding.equip).length > 0;
}
