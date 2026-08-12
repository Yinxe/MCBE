// ─── NBT 存储绑定表辅助（core 层纯逻辑） ────────────────
// 假人背包格/装备槽 ↔ nbt-data-storage 槽位（slotId）的映射操作。
// 槽位由库的 `put` 惰性分配（复用分配/回收语义，绝不与他人冲突），
// 映射表随 BotRecord 持久化（改名零迁移）。零 @minecraft 依赖，可 node 单测。

import { INVENTORY_SIZE } from "../model/Types";
import type { StorageBinding } from "../model/Types";

/** 新建空绑定表（全部槽位未绑定） */
export function createBinding(regionId: string): StorageBinding {
  return { regionId, inv: new Array(INVENTORY_SIZE).fill(null), equip: {} };
}

/** 背包格 → 绑定 slotId（undefined = 未绑定） */
export function boundSlotId(binding: StorageBinding | undefined, slot: number): number | undefined {
  const v = binding?.inv[slot];
  return v ?? undefined;
}

/** 装备槽名 → 绑定 slotId（undefined = 未绑定） */
export function boundEquipSlotId(binding: StorageBinding | undefined, slotName: string): number | undefined {
  const v = binding?.equip[slotName];
  return v ?? undefined;
}

/** 写入背包格绑定（slotId 必须是非负整数；写回后返回是否发生变更） */
export function bindSlot(binding: StorageBinding, slot: number, slotId: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= INVENTORY_SIZE) {
    throw new Error(`背包格越界: ${slot}（0-${INVENTORY_SIZE - 1}）`);
  }
  if (!Number.isInteger(slotId) || slotId < 0) {
    throw new Error(`非法 slotId: ${slotId}`);
  }
  binding.inv[slot] = slotId;
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
  if (slot >= 0 && slot < INVENTORY_SIZE) binding.inv[slot] = null;
}

/** 清空装备槽绑定（未绑定时无操作） */
export function unbindEquipSlot(binding: StorageBinding, slotName: string): void {
  binding.equip[slotName] = null;
}

/** 全部已绑定 slotId（删除假人时逐个 take 释放用） */
export function allBoundSlotIds(binding: StorageBinding): number[] {
  const ids: number[] = [];
  for (const v of binding.inv) {
    if (v !== null) ids.push(v);
  }
  for (const v of Object.values(binding.equip)) {
    if (v !== null) ids.push(v);
  }
  return ids;
}

/** 是否任何槽位已绑定（有存档判定） */
export function hasAnyBinding(binding: StorageBinding | undefined): boolean {
  if (!binding) return false;
  return binding.inv.some((v) => v !== null) || Object.values(binding.equip).some((v) => v !== null);
}
