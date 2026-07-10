/**
 * ============================================================================
 * NameMap 类型定义
 * ============================================================================
 *
 * 所有 nameMap 的类型定义。ItemNameMap 是 typeId → 中文名的键值映射。
 * ============================================================================
 */

/** 物品/方块 ID → 中文显示名的映射 */
export type ItemNameMap = Record<string, string>;

/** 效果 ID → 中文名映射 */
export type EffectNameMap = Record<string, string>;

/** 附魔 ID → 中文名映射 */
export type EnchantmentNameMap = Record<string, string>;

/** 实体 ID → 中文名映射 */
export type EntityNameMap = Record<string, string>;

/** 生物群系 ID → 中文名映射 */
export type BiomeNameMap = Record<string, string>;
