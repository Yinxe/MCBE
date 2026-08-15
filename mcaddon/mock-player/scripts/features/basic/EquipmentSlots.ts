// ─── 装备槽名称 ↔ EquipmentSlot 枚举映射（mc 层） ────────
// core 层统一用字符串槽名（EquipSlotName），到 mc 边界转换为 EquipmentSlot 枚举。

import { EquipmentSlot } from "@minecraft/server";
import type { EquipSlotName } from "../../rules/Types";

/** 装备槽名称 → EquipmentSlot 枚举映射 */
export const EQUIP_SLOT_MAP: Record<EquipSlotName, EquipmentSlot> = {
  head: EquipmentSlot.Head,
  chest: EquipmentSlot.Chest,
  legs: EquipmentSlot.Legs,
  feet: EquipmentSlot.Feet,
  offhand: EquipmentSlot.Offhand,
};

/** 可互换的装备槽列表（不含主手），用于装备互换/卸甲 */
export const SWAP_SLOTS: EquipmentSlot[] = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];
