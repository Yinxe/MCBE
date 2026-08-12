// ─── 物品规则（core 层） ────────────────────────────────
// 纯逻辑：typeId 字符串 → 装备槽判定（不含 mc 的 EquipmentSlot 枚举）。

import type { EquipSlotName } from "../model/Types";

/** 根据 typeId 判断物品属于哪个装备槽（字符串槽名），非装备返回 undefined */
export function getEquipmentSlot(typeId: string): EquipSlotName | undefined {
  if (typeId === "minecraft:elytra") return "chest";
  if (typeId === "minecraft:carved_pumpkin") return "head";
  if (typeId.includes("skull") || typeId.includes("_head")) return "head";
  if (typeId.endsWith("_helmet")) return "head";
  if (typeId.endsWith("_chestplate")) return "chest";
  if (typeId.endsWith("_leggings")) return "legs";
  if (typeId.endsWith("_boots")) return "feet";
  return undefined;
}

/** 判断是否为可穿戴装备（盔甲/鞘翅/南瓜/头颅等） */
export function isWearableItem(typeId: string): boolean {
  return getEquipmentSlot(typeId) !== undefined;
}