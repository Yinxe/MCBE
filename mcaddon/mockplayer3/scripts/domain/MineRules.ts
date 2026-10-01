// ─── 定点机械节拍域规则（domain 纯逻辑） ────────────
// 排除清单只防两类死循环：技术方块 breakBlock 永不消失（准星撞上即无限空挥）；
// 液体不算候选（一旦计入破坏原子的"已消失"判定，就会先报破坏成功、
// 下一拍同一格又还在，如此无限循环）。
// 除此之外不做任何"挖不动"预测：挖掘模式内永不停机，挖不动就按节拍继续挥，
// 靠节拍本身控制频率，不需要额外的失败预判。

import type { ToolStrategy } from "./HarvestRules";

/** 视线没有目标/实体为瞬态时的低频重探间隔（tick） */
export const IDLE_RECHECK_TICKS = 10;

/** 逐动作节拍（tick，写死不入配置）：挖掘 2、放置 3、攻击 8，各假人独立相位机互不干扰；
 *  放置一个方块占发起+收口两拍（收口固定 +1t），发起间隔 3 时整周期 4 tick/块 */
export const MINE_SWING_TICKS = 2;
export const PLACE_INTERVAL_TICKS = 3;
export const ATTACK_INTERVAL_TICKS = 8;

/** 非候选方块精确 id（技术方块/传送门/植被类——breakBlock 不产出或引擎拒破） */
const NON_MINEABLE_EXACT: ReadonlySet<string> = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:water",
  "minecraft:lava",
  "minecraft:flowing_water",
  "minecraft:flowing_lava",
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:invisible_bedrock",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:structure_block",
  "minecraft:structure_void",
  "minecraft:jigsaw",
  "minecraft:moving_block",
  "minecraft:allow",
  "minecraft:deny",
  "minecraft:border_block",
  "minecraft:end_portal",
  "minecraft:end_gateway",
  "minecraft:end_portal_frame",
  "minecraft:fire",
  "minecraft:soul_fire",
]);

/** 非候选方块前缀（覆盖 light_block_0..15 变体） */
const NON_MINEABLE_PREFIXES: readonly string[] = ["minecraft:light_block"];

/**
 * 是否为合法挖掘候选格方块。
 * @param typeId - 方块类型 id（准星射线命中的引擎真值 id）
 */
export function isMineCandidate(typeId: string): boolean {
  if (NON_MINEABLE_EXACT.has(typeId)) return false;
  return !NON_MINEABLE_PREFIXES.some((p) => typeId.startsWith(p));
}

/**
 * 方块类型 → 采集工具策略（挖掘侧按当下命中格选主手工具）。
 * 关键字匹配，按序取首个命中；未覆盖的方块（含未知模组方块）返回 undefined=保持当前主手。
 * 口径为启发式：石/矿/金属归镐、土方归铲、木族归斧、树叶归锄剪，宁可少切不错切。
 * @param typeId - 命中格方块 id（如 minecraft:stone）
 * @returns 工具策略，或 undefined（不可归类，不换装）
 */
export function toolStrategyForBlock(typeId: string): ToolStrategy | undefined {
  const sub = typeId.startsWith("minecraft:") ? typeId.slice("minecraft:".length) : typeId;
  for (const [strategy, keywords] of STRATEGY_KEYWORDS) {
    if (keywords.some((k) => sub.includes(k))) return strategy;
  }
  return undefined;
}

/** 方块关键字 → 工具策略（顺序即优先级：叶→木→石矿→土） */
const STRATEGY_KEYWORDS: ReadonlyArray<readonly [ToolStrategy, readonly string[]]> = [
  ["leaf", ["leaves"]],
  [
    "axe",
    [
      "log",
      "stem",
      "planks",
      "wood",
      "hyphae",
      "bookshelf",
      "ladder",
      "chest",
      "barrel",
      "sign",
      "door",
      "fence",
      "trapdoor",
      "crafting_table",
      "loom",
      "cartography",
      "fletching",
      "smithing",
    ],
  ],
  [
    "pickaxe",
    [
      "stone",
      "ore",
      "deepslate",
      "obsidian",
      "netherrack",
      "nether",
      "basalt",
      "granite",
      "diorite",
      "andesite",
      "terracotta",
      "concrete",
      "brick",
      "glass",
      "prismarine",
      "quartz",
      "coal",
      "iron",
      "gold",
      "copper",
      "diamond",
      "emerald",
      "redstone",
      "lapis",
      "netherite",
      "purpur",
      "end_",
      "grindstone",
      "anvil",
      "hopper",
      "furnace",
      "smoker",
      "blast",
      "chain",
      "lodestone",
      "beacon",
      "ice",
      "packed_ice",
      "blue_ice",
    ],
  ],
  [
    "shovel",
    ["dirt", "grass", "sand", "gravel", "clay", "mycelium", "podzol", "farmland", "snow", "mud", "path", "powder_snow"],
  ],
];
