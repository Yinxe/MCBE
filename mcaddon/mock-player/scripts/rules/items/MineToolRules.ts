// ─── 挖掘工具规则（core 层） ────────────────────────────
// 纯逻辑：方块类型 → 工具类别映射 + 最优工具评分（容器无关）。
// 服务 workMode="mine" 定点挖掘任务（按视线方块类型自动换最优工具）；
// 与砍树的 WoodcutRules 平行：评分复用同一套品阶/附魔权重（用户规格
// 「品阶优先 / 效率>耐久>精准>时运」），类别映射按挖掘场景扩展
// （镐/斧/锹/锄/剑全覆盖）。

import { materialTier, ENCHANT_WEIGHTS, TIER_WEIGHT } from "../woodcut/WoodcutRules";

// ─── 方块 → 工具类别映射 ───────────────────────────────

/** 通用挖掘工具类别（minecraft 命名对齐 `_pickaxe/_axe/_shovel/_hoe/_sword` 后缀） */
export type MineToolCategory = "pickaxe" | "axe" | "shovel" | "hoe" | "sword";

/** 方块 typeId 关键字 → 最优工具类别（顺序即优先级；未命中 → 空手兜底） */
const BLOCK_TOOL_RULES: readonly { keyword: string; category: MineToolCategory }[] = [
  // 镐类（石质/金属/矿物——挖掘主场景）
  { keyword: "_ore", category: "pickaxe" },
  { keyword: "deepslate", category: "pickaxe" },
  { keyword: "stone", category: "pickaxe" },
  { keyword: "cobble", category: "pickaxe" },
  { keyword: "granite", category: "pickaxe" },
  { keyword: "diorite", category: "pickaxe" },
  { keyword: "andesite", category: "pickaxe" },
  { keyword: "obsidian", category: "pickaxe" },
  { keyword: "bedrock", category: "pickaxe" },
  { keyword: "netherrack", category: "pickaxe" },
  { keyword: "end_stone", category: "pickaxe" },
  { keyword: "quartz_block", category: "pickaxe" },
  { keyword: "brick", category: "pickaxe" },
  { keyword: "prismarine", category: "pickaxe" },
  { keyword: "purpur", category: "pickaxe" },
  { keyword: "concrete", category: "pickaxe" },
  { keyword: "terracotta", category: "pickaxe" },
  { keyword: "furnace", category: "pickaxe" },
  { keyword: "dispenser", category: "pickaxe" },
  { keyword: "piston", category: "pickaxe" },
  { keyword: "hopper", category: "pickaxe" },
  { keyword: "rail", category: "pickaxe" },
  { keyword: "ice", category: "pickaxe" },
  { keyword: "magma", category: "pickaxe" },
  { keyword: "glass", category: "pickaxe" },
  { keyword: "amethyst", category: "pickaxe" },
  // 斧类（木质）
  { keyword: "_log", category: "axe" },
  { keyword: "wood", category: "axe" },
  { keyword: "planks", category: "axe" },
  { keyword: "fence", category: "axe" },
  { keyword: "door", category: "axe" },
  { keyword: "crafting_table", category: "axe" },
  { keyword: "chest", category: "axe" },
  { keyword: "barrel", category: "axe" },
  { keyword: "bookshelf", category: "axe" },
  { keyword: "melon", category: "axe" },
  { keyword: "pumpkin", category: "axe" },
  { keyword: "bamboo", category: "axe" },
  { keyword: "lectern", category: "axe" },
  { keyword: "noteblock", category: "axe" },
  { keyword: "jukebox", category: "axe" },
  { keyword: "campfire", category: "axe" },
  // 锹类（土质/沙质/雪）
  { keyword: "grass", category: "shovel" },
  { keyword: "dirt", category: "shovel" },
  { keyword: "sand", category: "shovel" },
  { keyword: "gravel", category: "shovel" },
  { keyword: "clay", category: "shovel" },
  { keyword: "mud", category: "shovel" },
  { keyword: "snow", category: "shovel" },
  { keyword: "soul_", category: "shovel" },
  { keyword: "farmland", category: "shovel" },
  { keyword: "podzol", category: "shovel" },
  { keyword: "mycelium", category: "shovel" },
  { keyword: "path", category: "shovel" },
  // 锄类（干草/目标方块/海绵/树叶类精细）
  { keyword: "hay", category: "hoe" },
  { keyword: "target", category: "hoe" },
  { keyword: "sponge", category: "hoe" },
  { keyword: "nether_wart_block", category: "hoe" },
  { keyword: "shroomlight", category: "hoe" },
  { keyword: "leaves", category: "hoe" },
  { keyword: "sculk", category: "hoe" },
  // 剑类（蛛网/竹子由斧快，但剑对蛛网/部分植物最快——保守只认蛛网）
  { keyword: "cobweb", category: "sword" },
];

/** 方块 typeId → 最优工具类别（未命中返回 undefined = 不指定，空手/当前手兜底） */
export function mineToolCategoryOf(blockTypeId: string): MineToolCategory | undefined {
  const id = blockTypeId.replace("minecraft:", "");
  for (const rule of BLOCK_TOOL_RULES) {
    if (id.includes(rule.keyword)) return rule.category;
  }
  return undefined;
}

/** 工具类别 → typeId 后缀（评分器甄别用；剑全名 minecraft:sword_* 无后缀统一处理） */
function categorySuffixOf(category: MineToolCategory): string | undefined {
  switch (category) {
    case "pickaxe": return "_pickaxe";
    case "axe": return "_axe";
    case "shovel": return "_shovel";
    case "hoe": return "_hoe";
    case "sword": return "_sword";
  }
}

// ─── 评分（品阶优先 / 效率>耐久>精准>时运——对齐砍树斧头策略） ──

/** 评分入参的最小结构（槽位/typeId/附魔——与砍树 ToolItem 兼容） */
export interface MineToolEntry {
  /** 槽位 */
  slot: number;
  /** 物品 typeId（如 minecraft:diamond_pickaxe） */
  typeId: string;
  /** 附魔 {id, level} 列表 */
  enchantments: { id: string; level: number }[];
}

/** 附魔等级读取（未附魔返回 0；与砍树 enchantLevel 同语义） */
function enchantOf(item: MineToolEntry, id: string): number {
  return item.enchantments.find((e) => e.id === id)?.level ?? 0;
}

/**
 * 指定类别的最优工具评分：
 * score = tier×1000 + efficiency×100 + unbreaking×30 + silk_touch×10 + fortune×3
 * 非指定类别返回 -1（不参与选择）。
 */
export function scoreMineTool(item: MineToolEntry, category: MineToolCategory): number {
  const suffix = categorySuffixOf(category);
  if (!suffix) return -1;
  if (!item.typeId.endsWith(suffix)) return -1;
  return (
    materialTier(item.typeId) * TIER_WEIGHT +
    enchantOf(item, "efficiency") * ENCHANT_WEIGHTS.efficiency +
    enchantOf(item, "unbreaking") * ENCHANT_WEIGHTS.unbreaking +
    enchantOf(item, "silk_touch") * ENCHANT_WEIGHTS.silk_touch +
    enchantOf(item, "fortune") * ENCHANT_WEIGHTS.fortune
  );
}

// ─── 选工具（纯函数） ─────────────────────────────────

/**
 * 选择挖掘某类方块的最优工具（返回槽位号；无可选返回 undefined）。
 * 策略：按方块类型映射最优类别 → 该类别中评分最高者入主手；
 * 主手已是该类工具且评分不劣 → 返回 undefined（不折腾换装）。
 * @param blockTypeId 目标方块 typeId
 * @param items        背包快照（全背包工具条目）
 * @param handSlot     当前主手槽位（-1 = 未知；避免同工具反复换装）
 * @returns 最优工具槽位（无需更换 → undefined）
 */
export function pickBestMineTool(
  blockTypeId: string,
  items: readonly MineToolEntry[],
  handSlot: number,
): number | undefined {
  const category = mineToolCategoryOf(blockTypeId);
  if (!category) return undefined; // 未映射：空手/当前手挖（不折腾）

  let best: MineToolEntry | undefined;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = scoreMineTool(item, category);
    if (s < 0) continue;
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  if (!best) return undefined;

  // 主手已是最优（同槽位）→ 不折腾
  if (best.slot === handSlot) return undefined;
  return best.slot;
}

// ─── 攻击武器（定点攻击任务） ─────────────────────────

/** 武器评分附魔权重（锋利主属性；耐久次之——对齐挖掘权重风格） */
const WEAPON_ENCHANT_WEIGHTS = { sharpness: 200, unbreaking: 30 } as const;
/** 剑对斧的攻速优势（固定加成——剑 > 同品阶斧） */
const SWORD_BONUS = 500;

/**
 * 近战武器评分（剑 > 同品阶斧；品阶优先 + 锋利主属性）：
 * score = tier×1000 + sharpness×200 + unbreaking×30 + (剑 +500)
 * 非剑/斧物品返回 -1（不参与选择）。
 */
export function scoreWeapon(item: MineToolEntry): number {
  const isSword = item.typeId.endsWith("_sword");
  const isAxe = item.typeId.endsWith("_axe");
  if (!isSword && !isAxe) return -1;
  return (
    materialTier(item.typeId) * TIER_WEIGHT +
    enchantOf(item, "sharpness") * WEAPON_ENCHANT_WEIGHTS.sharpness +
    enchantOf(item, "unbreaking") * WEAPON_ENCHANT_WEIGHTS.unbreaking +
    (isSword ? SWORD_BONUS : 0)
  );
}

/**
 * 选择最优近战武器（返回槽位号；主手已最优/无武器返回 undefined）。
 */
export function pickBestWeapon(items: readonly MineToolEntry[], handSlot: number): number | undefined {
  let best: MineToolEntry | undefined;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = scoreWeapon(item);
    if (s < 0) continue;
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  if (!best || best.slot === handSlot) return undefined;
  return best.slot;
}
