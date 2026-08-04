/**
 * ============================================================================
 * NameMap 合并索引
 * ============================================================================
 *
 * 将各分类 nameMap 合并为统一的大表。
 * - itemsMap: 所有物品/方块的中文名（颜色/木头/台阶/特殊物品等全覆盖）
 * - effectsMap: 效果 ID → 中文名
 * - enchantmentsMap: 附魔 ID → 中文名
 * - entitiesMap: 实体 ID → 中文名
 * ============================================================================
 */

import itemsDirect from "./items-direct";
import itemsColors from "./items-colors";
import itemsWoods from "./items-woods";
import itemsCompounds from "./items-compounds";
import itemsSpecial from "./items-special";
import itemsFallback from "./items-fallback";
import itemsGaps from "./items-gaps";
import effects from "./effects";
import enchantments from "./enchantments";
import entities from "./entities";

// ─── 物品 NameMap 合并（优先级：direct > gaps > colors > woods > compounds > special > fallback） ───

/**
 * 所有 Minecraft 物品/方块的中文名映射。
 * 包含 1396 个条目，对应 vanilla-data 的 MinecraftItemTypes 枚举。
 * 优先级顺序：
 *   1. items-direct（直通 item./tile. 键）
 *   2. items-gaps（修正颜色的间隙翻译）
 *   3. items-colors（颜色变体）
 *   4. items-woods（木类变体）
 *   5. items-compounds（台阶/楼梯/墙）
 *   6. items-special（特殊物品）
 *   7. items-fallback（英文回退）
 */
export const itemsMap: Record<string, string> = {
  ...itemsFallback,
  ...itemsSpecial,
  ...itemsCompounds,
  ...itemsWoods,
  ...itemsColors,
  ...itemsGaps,
  ...itemsDirect,
};

// ─── 其他 NameMap ───

/** 效果 ID → 中文名 */
export const effectsMap = effects;

/** 附魔 ID → 中文名 */
export const enchantmentsMap = enchantments;

/** 实体 ID → 中文名 */
export const entitiesMap = entities;
