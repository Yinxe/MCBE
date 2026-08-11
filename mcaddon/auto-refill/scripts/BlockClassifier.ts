// ─── 方块识别（4 层可扩展） ────────────────────────────
// 识别方块对应的挖掘工具需求，产物为"按优先级的工具目标列表"。
//   顺序：瞬破排除 → 自定义策略（CUSTOM_RULES，表达偏好/优先级，如
//         "树叶→精准采集锄 > 剪刀"）→ 现代挖掘标签（is_*_item_destructible
//         家族一条覆盖 + *_tier_destructible 镐最低品质）→ 遗留标签
//         （*_pick_diggable / stone / dirt / log…）→ typeId 关键词兜底。
// 原则"宁缺毋滥"：不认识的方块返回 undefined（不干预），绝不换错工具。
// 扩展方式：偏好/优先/精准 → 补 CUSTOM_RULES（自定义策略）；通用兜底
// 词 → 补 ID_KEYWORDS。另有 wantsSilkTouch 标记：玻璃/冰/萤石等无工具
// 类别、但不用精准采集就无法产出方块本体的方块。

import { type Block } from "@minecraft/server";
import { type ToolCategory, type ToolRequirement, type ToolTarget } from "./types";
import { isInstantBreak } from "./InstantBreak";

// ─── 识别表 ────────────────────────────────────────────

/** 镐子最低品质 tag → 品质等级（最严格在前；diamond_ore 需 iron+、obsidian 需 diamond+） */
const PICK_TIER_BY_TAG: ReadonlyArray<readonly [tag: string, minTier: number]> = [
  ["diamond_pick_diggable", 5],
  ["gold_pick_diggable", 4],
  ["iron_pick_diggable", 3],
  ["stone_pick_diggable", 2],
  ["wooden_pick_diggable", 1],
];

/** 方块标签 → 工具类别（无品质约束，Bedrock 中长期稳定存在的原生标签） */
const TAG_TO_CATEGORY: ReadonlyArray<readonly [tag: string, tool: ToolCategory]> = [
  ["metal", "pickaxe"],
  ["stone", "pickaxe"],
  ["log", "axe"],
  ["wood", "axe"],
  ["pumpkin", "axe"],
  ["dirt", "shovel"],
  ["sand", "shovel"],
  ["gravel", "shovel"],
];

/** typeId 关键词 → 工具类别（精简、只收高置信的常用核心方块，按优先级排列） */
const ID_KEYWORDS: ReadonlyArray<readonly [keywords: readonly string[], tool: ToolCategory]> = [
  [
    [
      "ore",
      "stone",
      "deepslate",
      "obsidian",
      "anvil",
      "rail",
      "furnace",
      "spawner",
      "lantern",
      "terracotta",
      "concrete",
      "prismarine",
      "end_stone",
      "hopper",
      "chain",
      "bars",
      "lodestone",
      "respawn_anchor",
      "grindstone",
      "enchanting",
      "amethyst",
      "dripstone",
      "copper",
      "quartz",
      "netherite_block",
      "iron_block",
      "gold_block",
      "diamond_block",
      "emerald_block",
      "bell",
      "brewing_stand",
      "cauldron",
      "_wall",
      "brick",
      "iron_door",
      "iron_trapdoor",
    ],
    "pickaxe",
  ],
  [
    [
      "log",
      "stem",
      "stripped_",
      "plank",
      "fence",
      "door",
      "trapdoor",
      "chest",
      "bookshelf",
      "banner",
      "barrel",
      "campfire",
      "ladder",
      "sign",
      "note_block",
      "jukebox",
      "beehive",
      "bee_nest",
      "composter",
      "loom",
      "lectern",
      "table",
      "pumpkin",
      "mushroom_block",
    ],
    "axe",
  ],
  [
    [
      "dirt",
      "grass_block",
      "sand",
      "gravel",
      "clay",
      "snow",
      "mud",
      "podzol",
      "mycelium",
      "farmland",
      "path",
      "soul_sand",
      "soul_soil",
      "rooted_dirt",
      "powder_snow",
    ],
    "shovel",
  ],
  [
    [
      "hay_block",
      "dried_kelp_block",
      "sculk",
      "sponge",
      "moss_block",
      "target",
      "shroomlight",
      "nether_wart_block",
      "warped_wart_block",
    ],
    "hoe",
  ],
  [["leaves", "wool", "cobweb", "vine", "glow_lichen"], "shears"],
];

/** typeId 关键词 → 无工具类别偏好、但推荐精准采集（玻璃/片/冰/萤石/海晶灯） */
const SILK_TOUCH_KEYWORDS: readonly string[] = ["glass", "ice", "glowstone", "sea_lantern"];

// ─── 自定义方块规则（可扩展） ───────────────────────────

/** 自定义方块工具需求：比通用规则（标签/关键词）更精确，首个命中者胜出。 */
interface CustomBlockRule {
  readonly name: string;
  readonly match: (typeId: string) => boolean;
  /** 按优先级排列的工具目标：主手命中任一即正确；换入时按顺序取第一个有货且达标者 */
  readonly targets: ReadonlyArray<ToolTarget>;
}

/**
 * 自定义规则注册表（按数组顺序，首个命中者胜出）。
 * 只放"现代挖掘标签表达不了"的策略偏好（优先级/精准采集）：
 *   - 树叶 → 优先精准采集锄头（能完整产出树叶方块），其次剪刀
 *   - 草方块/灰化土/菌丝 → 优先精准采集锹（保留方块本体），其次锹
 * 纯识别缺口（如草径 grass_path/dirt_path）由现代标签 + 关键词兜底，无需在此登记。
 * 需要新增方块偏好时在此追加一条 CustomBlockRule 即可。
 */
const CUSTOM_RULES: ReadonlyArray<CustomBlockRule> = [
  // {
  //   name: "leaves",
  //   match: (id) => id.endsWith("_leaves"),
  //   targets: [{ category: "hoe", silk: true }, { category: "shears" }],
  // },
  // {
  //   name: "grass_block_family",
  //   match: (id) => id === "minecraft:grass_block" || id === "minecraft:podzol" || id === "minecraft:mycelium",
  //   targets: [{ category: "shovel", silk: true }, { category: "shovel" }],
  // },
];

// ─── 现代挖掘标签（已实证 hasTag 可读，见游戏日志） ─────

/** 现代挖掘标签 minecraft:is_*_item_destructible → 类别；方块挂几个就得几个目标（按此序排列） */
const DESTRUCTIBLE_TO_CATEGORY: ReadonlyArray<readonly [tag: string, category: ToolCategory]> = [
  ["minecraft:is_pickaxe_item_destructible", "pickaxe"],
  ["minecraft:is_axe_item_destructible", "axe"],
  ["minecraft:is_shovel_item_destructible", "shovel"],
  ["minecraft:is_hoe_item_destructible", "hoe"],
  ["minecraft:is_shears_item_destructible", "shears"],
];

/** 镐子最低品质现代标签 minecraft:is_*_tier_destructible → 品质（最严格在前） */
const PICK_TIER_BY_MODERN_TAG: ReadonlyArray<readonly [tag: string, minTier: number]> = [
  ["minecraft:is_diamond_tier_destructible", 5],
  ["minecraft:is_gold_tier_destructible", 4],
  ["minecraft:is_iron_tier_destructible", 3],
  ["minecraft:is_stone_tier_destructible", 2],
  ["minecraft:is_wood_tier_destructible", 1],
];

// ─── 安全包装 ──────────────────────────────────────────

/**
 * 查询方块是否带指定标签；命名空间兼容（带不带 minecraft: 前缀都可）。
 * 脚本 API 在此抛错时返回 false，不中断识别。
 * @param block 目标方块
 * @param tag   标签名
 */
function safeHasTag(block: Block, tag: string): boolean {
  try {
    if (block.hasTag(tag)) return true;
    if (!tag.includes(":")) return block.hasTag("minecraft:" + tag);
    return false;
  } catch {
    return false;
  }
}

/**
 * 子串匹配——str 含任一词条即命中。
 * @param str      被匹配字符串（如 block.typeId）
 * @param keywords 词条列表
 */
function matchAny(str: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => str.includes(k));
}

/** 构造单目标需求（通用规则的产物）：省略可选的 minTier 字段保持简洁。 */
function singleTarget(category: ToolCategory, minTier: number | undefined): ToolTarget {
  return minTier === undefined ? { category } : { category, minTier };
}

/** 从方块标签识别工具（含镐子最低品质），未命中返回 undefined。 */
function detectByTag(block: Block): ToolRequirement | undefined {
  // 镐子最低品质 tag：能挖掘但仍需更高品质才掉落（先最严格的）
  for (const [tag, minTier] of PICK_TIER_BY_TAG) {
    if (safeHasTag(block, tag)) return { targets: [singleTarget("pickaxe", minTier)], path: `tag:${tag}` };
  }
  // 类别 tag（无品质约束）
  for (const [tag, tool] of TAG_TO_CATEGORY) {
    if (safeHasTag(block, tag)) return { targets: [{ category: tool }], path: `tag:${tag}` };
  }
  return undefined;
}

/** 现代挖掘标签识别：方块带哪些 is_*_item_destructible 就得哪些目标（按优先级排列）。 */
function detectByModernTags(block: Block): ToolRequirement | undefined {
  let minTier: number | undefined;
  for (const [tag, tier] of PICK_TIER_BY_MODERN_TAG) {
    if (safeHasTag(block, tag)) {
      minTier = tier;
      break;
    }
  }
  const targets: ToolTarget[] = [];
  for (const [tag, category] of DESTRUCTIBLE_TO_CATEGORY) {
    if (!safeHasTag(block, tag)) continue;
    targets.push(singleTarget(category, category === "pickaxe" ? minTier : undefined));
  }
  if (targets.length === 0) return undefined;
  return { targets, path: `tag:${targets.map((t) => t.category).join(">")}` };
}

// ─── 公开识别 ──────────────────────────────────────────

/**
 * 识别方块对应的挖掘工具需求（可扩展：自定义策略 → 现代标签 → 遗留标签 → 关键词）。
 *
 * 顺序：瞬破排除 → 自定义规则（CUSTOM_RULES，首个命中者胜出，表达偏好/优先级）→
 *       现代挖掘标签（is_*_item_destructible 家族一条覆盖；镐附加 *_tier_destructible
 *       最低品质）→ 遗留标签（*_pick_diggable / stone / dirt / log…）→ typeId 关键词兜底。
 *
 * @param block 目标方块
 * @returns 工具需求（按优先级的目标列表）；方块无工具偏好（玻璃/花/火把等）返回 undefined
 */
export function classify(block: Block): ToolRequirement | undefined {
  const id = block.typeId;
  // 瞬破方块排除（名字常含干扰词，先兜住）
  if (isInstantBreak(id)) return undefined;

  // 第一层：自定义策略（覆盖通用规则，表达精确偏好/优先级）
  for (const rule of CUSTOM_RULES) {
    if (rule.match(id)) return { targets: rule.targets, path: `custom:${rule.name}` };
  }

  // 第二层：现代挖掘标签（家族一条覆盖，镐带最低品质）
  const modern = detectByModernTags(block);
  if (modern) return modern;

  // 第三层：遗留标签（旧 *_pick_diggable / stone / dirt / log …）
  const legacy = detectByTag(block);
  if (legacy) return legacy;

  // 第四层：typeId 关键词兜底
  for (const [keywords, tool] of ID_KEYWORDS) {
    if (matchAny(id, keywords)) return { targets: [{ category: tool }], path: "keyword" };
  }
  return undefined;
}

/**
 * 该方块是否推荐用精准采集采集。
 * 玻璃/玻璃片/冰/萤石/海晶灯等：无"正确工具"类别，但不用精准采集就无法
 * 产出方块本体（玻璃会碎掉、冰只出冰水），因此哪怕没有合适工具也应换上
 * 一把带精准采集的任意工具。
 * @param block 目标方块
 */
export function wantsSilkTouch(block: Block): boolean {
  return matchAny(block.typeId, SILK_TOUCH_KEYWORDS);
}
