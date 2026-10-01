// ─── 装备槽映射（domain 字符串名 ↔ 引擎枚举，engine 边界唯一换算处） ──
// 槽名真源在 Record.EQUIP_SLOT_NAMES，枚举换算集中于此供 EntityOps/Equpper 共用。

import { EquipmentSlot } from "@minecraft/server";
import type { EquipSlotName } from "../domain/Record";

/** domain 装备槽名 → 引擎枚举，供 EntityOps/Equpper 共用 */
export const EQUIP_SLOT_MAP: Record<EquipSlotName, EquipmentSlot> = {
  head: EquipmentSlot.Head,
  chest: EquipmentSlot.Chest,
  legs: EquipmentSlot.Legs,
  feet: EquipmentSlot.Feet,
  offhand: EquipmentSlot.Offhand,
};
