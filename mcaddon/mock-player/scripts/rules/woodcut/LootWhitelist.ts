// ─── 砍树磁吸掉落物白名单（core 规则） ──────────────────
// vacuumNearbyDrops 的"感兴趣掉落物"过滤（砍树模式）。
// ⚠️ 方块 ID ≠ 掉落物物品 ID：树叶方块 minecraft:oak_leaves 破坏后掉的是
//   **树苗/苹果/木棍**（剪刀挖才掉树叶本体）——磁吸白名单必须按**物品 id**
//   过滤，只给方块 id 会漏树苗（收集模式核心目标）。
// 纯数据：由 TREE_LOG_TYPE_IDS（圆木本体）+ 树叶相关掉落物（树苗/果实/花）组成。

import { TREE_LOG_TYPE_IDS } from "../tree/TreeRules";

/** 树苗物品 ID（各树种 sapling；树叶破坏主要掉落） */
const SAPLING_IDS = [
  "minecraft:oak_sapling",
  "minecraft:spruce_sapling",
  "minecraft:birch_sapling",
  "minecraft:jungle_sapling",
  "minecraft:acacia_sapling",
  "minecraft:dark_oak_sapling",
  "minecraft:cherry_sapling",
  "minecraft:pale_oak_sapling",
  "minecraft:mangrove_propagule",
  "minecraft:azalea",
  "minecraft:flowering_azalea",
] as const;

/** 树叶破坏的其他可能掉落（果实/附着物/木棍） */
const LEAF_MISC_IDS = [
  "minecraft:apple",
  "minecraft:golden_apple",
  "minecraft:stick",
  "minecraft:brown_mushroom",
  "minecraft:red_mushroom",
] as const;

/**
 * 砍树模式感兴趣掉落物白名单（圆木本体 + 树叶掉落物——树苗/果实/木棍）。
 * 圆木方块 id 与掉落物品 id 一致可直接复用；树叶按**掉落物 id** 列举。
 */
export const WOODCUT_LOOT_TYPES: readonly string[] = [
  ...TREE_LOG_TYPE_IDS,
  ...SAPLING_IDS,
  ...LEAF_MISC_IDS,
];
