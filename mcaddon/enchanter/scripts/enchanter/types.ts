import { EnchantmentType } from "@minecraft/server";

// ─── 功能枚举 ──────────────────────────────────────────────────────

/**
 * 两种核心功能。
 * 附魔铭刻 — 在物品上增加新的附魔词条
 * 附魔超限 — 突破原版上限提升附魔等级
 */
export type EnchantOperation = "inscribe" | "overlimit";

// ─── 附魔分析结果 ──────────────────────────────────────────────────

export interface EnchantEntry {
  typeId: string;
  displayName: string;
  currentLevel: number;
  maxVanillaLevel: number;
  /** 是否已超过原版上限 */
  isOverlimited: boolean;
}

export interface ItemAnalysis {
  /** 是否可附魔物品 */
  isValid: boolean;
  /** 物品显示名称 */
  itemName: string;
  /** 物品 typeId */
  itemType: string;
  /** 当前附魔列表 */
  enchantments: EnchantEntry[];
  /** 空词条数（附魔台等价 - 实际上无此概念，保留为 0） */
  emptySlots: number;
}
