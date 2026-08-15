// ─── 带色文本格式化（mc 层） ────────────────────────────
// 面向玩家的彩色文本（§ 色码经 @yinxe/toolkit color 生成）。
// 纯文本格式化在 core/format。

import { ItemStack } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import type { PositionState } from "../model/Types";
import { formatDimensionId } from "../format/Format";
import { ENCH_ZH } from "../format/EnchantZh";

export function formatPos(v: Vector3): string {
  return `${color.muted}[${color.info}${Math.floor(v.x)} ${color.info}${Math.floor(v.y)} ${color.info}${Math.floor(v.z)}${color.muted}]`;
}

export function formatState(state: PositionState): string {
  return `${formatPos(state.location)} ${color.darkGray}${formatDimensionId(state.dimension)} ${color.muted}旋转(${Math.floor(state.rotation.x)},${Math.floor(state.rotation.y)})`;
}

/**
 * 格式化物品的附魔列表为彩色字符串。
 * @returns 如 "§9锋利III §9击退II" 或 ""（无附魔）
 */
export function formatEnchantments(item: ItemStack): string {
  if (!item.hasComponent("minecraft:enchantable")) return "";
  const ench = item.getComponent("minecraft:enchantable") as any;
  if (!ench) return "";
  const parts: string[] = [];
  for (const e of ench.getEnchantments()) {
    const zh = ENCH_ZH[e.type.id] ?? e.type.id;
    parts.push(`${color.darkBlue}${zh}${e.level}`);
  }
  return parts.join(" ");
}

/** 格式化物品的耐久值为带颜色的字符串。返回 "" 表示无耐久组件 */
export function formatDurability(item: ItemStack): string {
  const dur = item.getComponent("minecraft:durability") as any;
  if (!dur) return "";
  const maxD = dur.maxDurability ?? 1;
  const dmg = dur.damage ?? 0;
  const cur = maxD - dmg;
  const pct = Math.floor((cur / maxD) * 100);
  const code = pct > 50 ? "" : pct > 20 ? color.darkGray : color.darkRed;
  return `${code}(${cur}/${maxD})`;
}