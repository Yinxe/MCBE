// ─── 工具选择策略树（rules 层，消费 @yinxe/tool-strategy） ──
// 可插拔引擎接入（2026-09-03 用户指引）：决策树（by-block 方块分发）+
// 档位策略（want 手排 + sortBy 维度链）——替代此前三处各自加权评分实现
//（WoodcutRules.scoreAxe/scoreLeavesTool、MineToolRules.scoreMineTool/
// scoreWeapon），根除加权评分表达不了的语义：
//   - 跨档交叉：`效率5铁斧 > 精准钻石镐 > 效率3铁斧`（单一分数维度排不出）
//   - 附魔硬门槛：require（必须带精准/时运等级区间）——加权只能软加分
//   - 耐久维度：sortBy durability + 紧急换装（快断的工具不再当选——
//     此前实现完全没考虑耐久，快断的镐照样当选）
// 引擎零 @minecraft 零依赖，决策（本文件）与背包 profile（mc 层）分离。

import {
  select,
  type ToolCandidate,
  type ToolDecision,
  type ToolStrategy,
  type ToolTree,
  type ToolTreeNode,
} from "@yinxe/tool-strategy/src/index";

// ─── 耐久保护（对齐 auto-refill 语义） ────────────────

/** 耐久紧急占比阈值（剩余耐久占比低于此值 → 紧急换装） */
export const URGENT_DURABILITY_RATIO = 0.05;
/** 耐久紧急绝对下限（剩余点数低于此值不论占比都紧急） */
export const URGENT_DURABILITY_FLOOR = 16;

/**
 * 工具是否耐久紧急（占比 < 5% 或剩余 < 16 点——低最大耐久工具如木剑兜底）。
 * 不可破坏（maxDurability=0 无耐久组件）恒不紧急。
 */
export function isDurabilityUrgent(c: ToolCandidate): boolean {
  if (c.maxDurability <= 0 || c.durabilityRatio >= 1) return false; // 无耐久组件/满耐久
  return c.durabilityRatio < URGENT_DURABILITY_RATIO || c.durability < URGENT_DURABILITY_FLOOR;
}

// ─── 原子策略 ──────────────────────────────────────────

/**
 * 通用挖掘档位（按角色给定）：档内维度链 = 耐久紧急排除 → 品阶 → 效率 → 耐久占比。
 * ban 空手语义：无匹配候选时策略不命中（树继续/最终 keep 主手）。
 */
function digStrategy(name: string, role: ToolCandidate["role"]): ToolStrategy {
  return {
    name,
    want: [{ role }],
    sortBy: [{ dim: "tier" }, { dim: "enchant", type: "efficiency" }, { dim: "durability" }],
  };
}

/** 石质/矿物 → 镐 */
const PICKAXE_STRATEGY = digStrategy("mine-pickaxe", "pickaxe");
/** 木质 → 斧 */
const AXE_STRATEGY = digStrategy("mine-axe", "axe");
/** 土质/沙质 → 锹 */
const SHOVEL_STRATEGY = digStrategy("mine-shovel", "shovel");
/** 干草/海绵/树叶类精细 → 锄 */
const HOE_STRATEGY = digStrategy("mine-hoe", "hoe");
/** 蛛网 → 剑 */
const SWORD_STRATEGY = digStrategy("mine-sword", "sword");

/**
 * 砍树原木策略（用户规格：效率斧——档内效率等级 → 品阶 → 耐久）。
 */
export const WOODCUT_LOG_STRATEGY: ToolStrategy = {
  name: "woodcut-log",
  want: [{ role: "axe" }],
  sortBy: [{ dim: "enchant", type: "efficiency" }, { dim: "tier" }, { dim: "durability" }],
};

/**
 * 砍树树叶策略（用户规格：精准锄头 > 剪刀 > 任意精准 > 任意工具，档位手排
 * 表达强制优先级——加权分数档 3000/2000/1000 模拟的时代结束）。
 */
export const WOODCUT_LEAF_STRATEGY: ToolStrategy = {
  name: "woodcut-leaf",
  want: [
    { role: "hoe", require: [{ type: "silk" }] }, // 档1 精准锄头
    { role: "shears" }, // 档2 剪刀
    { require: [{ type: "silk" }] }, // 档3 任意精准
    {}, // 档4 任意工具兜底
  ],
  sortBy: [{ dim: "tier" }, { dim: "durability" }],
};

/**
 * 攻击武器策略（剑 > 同品阶斧——档位手排；档内锋利 → 品阶 → 耐久）。
 */
export const WEAPON_STRATEGY: ToolStrategy = {
  name: "weapon",
  want: [{ role: "sword" }, { role: "axe" }],
  sortBy: [{ dim: "enchant", type: "sharpness" }, { dim: "tier" }, { dim: "durability" }],
};

// ─── 决策树 ────────────────────────────────────────────

/** by-block 快捷构造 */
function byBlock(match: (typeId: string) => boolean, node: ToolTreeNode): ToolTreeNode {
  return { type: "by-block", match, node };
}

/** 方块关键字 → 角色策略节点（挖掘分发；关键字对齐原 MineToolRules 映射表） */
const DIG_NODES: readonly ToolTreeNode[] = [
  byBlock((id) => DIG_KEYWORDS.pickaxe.some((k) => id.includes(k)), { type: "by-strategy", strategy: PICKAXE_STRATEGY }),
  byBlock((id) => DIG_KEYWORDS.axe.some((k) => id.includes(k)), { type: "by-strategy", strategy: AXE_STRATEGY }),
  byBlock((id) => DIG_KEYWORDS.shovel.some((k) => id.includes(k)), { type: "by-strategy", strategy: SHOVEL_STRATEGY }),
  byBlock((id) => DIG_KEYWORDS.hoe.some((k) => id.includes(k)), { type: "by-strategy", strategy: HOE_STRATEGY }),
  byBlock((id) => id.includes("cobweb"), { type: "by-strategy", strategy: SWORD_STRATEGY }),
];

/** 挖掘关键字表（方块 id 去掉 minecraft: 后 contains 匹配；原 MineToolRules 迁移） */
const DIG_KEYWORDS: Record<"pickaxe" | "axe" | "shovel" | "hoe", readonly string[]> = {
  pickaxe: ["_ore", "deepslate", "stone", "cobble", "granite", "diorite", "andesite", "obsidian", "bedrock",
    "netherrack", "end_stone", "quartz_block", "brick", "prismarine", "purpur", "concrete", "terracotta",
    "furnace", "dispenser", "piston", "hopper", "rail", "ice", "magma", "glass", "amethyst"],
  axe: ["_log", "wood", "planks", "fence", "door", "crafting_table", "chest", "barrel", "bookshelf",
    "melon", "pumpkin", "bamboo", "lectern", "noteblock", "jukebox", "campfire"],
  shovel: ["grass", "dirt", "sand", "gravel", "clay", "mud", "snow", "soul_", "farmland", "podzol",
    "mycelium", "path"],
  hoe: ["hay", "target", "sponge", "nether_wart_block", "shroomlight", "leaves", "sculk"],
};

/**
 * 砍树模式树（原木/树叶两分支——原 woodcut mode 语义：logs 模式树叶也走斧头
 * 策略由调用方不挂树叶分支实现；collect 模式挂全树）。
 * by-block 匹配用**方块 kind 分类**（classifyTreeBlock 语义内联——log/leaf 关键字）。
 */
export const WOODCUT_TREE: ToolTree = {
  name: "woodcut",
  nodes: [
    byBlock((id) => id.endsWith("_log") || id === "minecraft:log" || id === "minecraft:log2", {
      type: "by-strategy",
      strategy: WOODCUT_LOG_STRATEGY,
    }),
    byBlock((id) => id.includes("leaves") || id.endsWith("_leaves"), {
      type: "by-strategy",
      strategy: WOODCUT_LEAF_STRATEGY,
    }),
  ],
};

/**
 * 挖掘任务树（定点挖掘：方块关键字 → 角色策略；无命中 → keep 主手不动）。
 * 与砍树树分开：挖掘是通用场景（泥土/石头/矿物…），砍树是领域场景。
 */
export const MINE_TREE: ToolTree = {
  name: "mine",
  nodes: DIG_NODES,
};

/**
 * 统一决策入口（任务 ensureTool 消费；纯函数）：
 *   1. 耐久紧急排除：主手耐久紧急且有同角色更耐久候选 → 剔除主手（强制换）；
 *      候选中紧急者剔除（快断工具不当选——耐久保护绝不降级）
 *   2. 树求值：select（档位手排 + sortBy；主手已最优 → keep）
 * @param typeId    即将处理的目标方块 typeId（树 by-block 分发键）
 * @param current   当前主手候选（undefined = 空手）
 * @param candidates 背包候选（mc 层 profile，不含主手槽）
 * @param tree      场景树（WOODCUT_TREE / MINE_TREE / 攻击用单策略树）
 * @returns keep（保持主手，含原因）/ swap（换入最优，含槽位）
 */
export function decideTool(
  typeId: string,
  current: ToolCandidate | undefined,
  candidates: readonly ToolCandidate[],
  tree: ToolTree,
): ToolDecision {
  // 耐久保护：紧急候选不参与评选（主手紧急 → 强制走树换装；候选紧急 → 剔除）
  const urgentFree = candidates.filter((c) => !isDurabilityUrgent(c));
  const currentUrgent = current ? isDurabilityUrgent(current) : false;
  return select(typeId, currentUrgent ? undefined : current, urgentFree, {
    tree,
    reselectIfCurrent: false, // 主手命中策略 → 保持（省耐久）；紧急主手已强制换
  });
}

/**
 * 武器决策（攻击任务专用：无方块键——固定树挂武器策略叶子）。
 */
export function decideWeapon(
  current: ToolCandidate | undefined,
  candidates: readonly ToolCandidate[],
): ToolDecision {
  const weaponTree: ToolTree = { name: "weapon", nodes: [{ type: "by-strategy", strategy: WEAPON_STRATEGY }] };
  return decideTool("", current, candidates, weaponTree);
}
