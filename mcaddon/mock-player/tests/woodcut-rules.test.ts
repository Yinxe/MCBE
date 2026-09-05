// ─── core/rules/woodcut — 砍树模式与工具策略（WoodcutRules） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHOP_MODE_LABEL,
  materialTier,
  normalizeChopMode,
  pickBestTool,
  scoreAxe,
  scoreLeavesTool,
  toolCategoryOf,
  type ChopMode,
  type ToolItem,
} from "../scripts/rules/woodcut/WoodcutRules";

function item(overrides: Partial<ToolItem> & { typeId: string }): ToolItem {
  const { typeId, ...rest } = overrides;
  return {
    slot: 0,
    typeId,
    enchantments: [],
    category: typeId.includes("_axe") ? "axe" : typeId.includes("_hoe") ? "hoe" : "shears",
    ...rest,
  };
}

test("CHOP_MODE_LABEL：原木模式 / 收集模式", () => {
  assert.equal(CHOP_MODE_LABEL["logs"], "原木模式");
  assert.equal(CHOP_MODE_LABEL["collect"], "收集模式");
});

test("normalizeChopMode：枚举 only logs/collect，非法回退 fallback", () => {
  assert.equal(normalizeChopMode("logs"), "logs");
  assert.equal(normalizeChopMode("collect"), "collect");
  assert.equal(normalizeChopMode("LOGS"), "logs"); // 大小写归一由调用方做，这里原样
  assert.equal(normalizeChopMode("mine"), "logs"); // 非法 → fallback logs
  assert.equal(normalizeChopMode(undefined), "logs");
  assert.equal(normalizeChopMode("mine", "collect"), "collect"); // 显式 fallback
  assert.equal(normalizeChopMode("collect", "logs"), "collect");
});

test("toolCategoryOf：斧/锄/剪三类识别，非工具兜底 axe", () => {
  assert.equal(toolCategoryOf("minecraft:diamond_axe"), "axe");
  assert.equal(toolCategoryOf("minecraft:iron_axe"), "axe");
  assert.equal(toolCategoryOf("minecraft:golden_hoe"), "hoe");
  assert.equal(toolCategoryOf("minecraft:netherite_hoe"), "hoe");
  assert.equal(toolCategoryOf("minecraft:shears"), "shears");
  assert.equal(toolCategoryOf("minecraft:diamond_sword"), "axe"); // 非三类兜底
  assert.equal(toolCategoryOf("minecraft:oak_log"), "axe");
});

test("materialTier：品阶排序（wood<stone<iron<gold<diamond<netherite）", () => {
  assert.equal(materialTier("minecraft:wooden_axe"), 1);
  assert.equal(materialTier("minecraft:stone_axe"), 2);
  assert.equal(materialTier("minecraft:iron_axe"), 3);
  assert.equal(materialTier("minecraft:golden_axe"), 4);
  assert.equal(materialTier("minecraft:diamond_axe"), 5);
  assert.equal(materialTier("minecraft:netherite_axe"), 6);
  assert.equal(materialTier("minecraft:shears"), 0); // shears 无材质
});

test("scoreAxe：品阶优先，效率>耐久>精准>时运", () => {
  const stone = item({ typeId: "minecraft:stone_axe" });
  const woodGold = item({ typeId: "minecraft:wooden_axe", enchantments: [{ id: "efficiency", level: 1 }] });
  // 品阶优先：stone axe（5000）> wooden axe + 效率（3000+100）
  assert.ok(scoreAxe(stone) > scoreAxe(woodGold));
  // 同品阶：效率权重 > 耐久 > 精准 > 时运（每级）
  const eff = item({ typeId: "minecraft:iron_axe", enchantments: [{ id: "efficiency", level: 1 }] });
  const unbr = item({ typeId: "minecraft:iron_axe", enchantments: [{ id: "unbreaking", level: 1 }] });
  const silk = item({ typeId: "minecraft:iron_axe", enchantments: [{ id: "silk_touch", level: 1 }] });
  const fort = item({ typeId: "minecraft:iron_axe", enchantments: [{ id: "fortune", level: 1 }] });
  assert.ok(scoreAxe(eff) > scoreAxe(unbr));
  assert.ok(scoreAxe(unbr) > scoreAxe(silk));
  assert.ok(scoreAxe(silk) > scoreAxe(fort));
  // 非斧头不参与斧头策略
  assert.equal(scoreAxe(item({ typeId: "minecraft:shears" })), -1);
});

test("scoreLeavesTool：精准锄头 > 剪刀 > 任意精准工具 > 兜底", () => {
  const silkHoe = item({ typeId: "minecraft:diamond_hoe", enchantments: [{ id: "silk_touch", level: 1 }] });
  const shears = item({ typeId: "minecraft:shears" });
  const silkAxe = item({ typeId: "minecraft:diamond_axe", enchantments: [{ id: "silk_touch", level: 1 }] });
  assert.ok(scoreLeavesTool(silkHoe) > scoreLeavesTool(shears));
  assert.ok(scoreLeavesTool(shears) > scoreLeavesTool(silkAxe));
  // 兜底：普通斧头也能破树叶（分数 > -1）
  assert.ok(scoreLeavesTool(item({ typeId: "minecraft:iron_axe" })) > 0);
});

test("pickBestTool：圆木→斧头策略；树叶(原木模式)→斧头策略；树叶(收集模式)→树叶策略强制应用", () => {
  const inv: ToolItem[] = [
    item({ slot: 0, typeId: "minecraft:diamond_axe", enchantments: [{ id: "silk_touch", level: 1 }] }), // 精准斧头（目前主手）
    item({ slot: 1, typeId: "minecraft:shears" }),
    item({ slot: 2, typeId: "minecraft:iron_hoe", enchantments: [{ id: "silk_touch", level: 1 }] }), // 精准锄头
  ];
  // 圆木（任何模式）→ 斧头策略：diamond axe
  assert.equal(pickBestTool("log", "logs", inv), 0);
  assert.equal(pickBestTool("log", "collect", inv), 0);
  // 树叶 + 原木模式 → 斧头策略（只用斧头）
  assert.equal(pickBestTool("leaf", "logs", inv), 0);
  // 树叶 + 收集模式 → 树叶策略强制应用：精准锄头（即使主手是精准斧头）
  assert.equal(pickBestTool("leaf", "collect", inv), 2);
});

test("pickBestTool：树叶收集模式——无精准锄/剪刀时选剪刀；仅精准斧头时选它", () => {
  const onlySilkAxe: ToolItem[] = [item({ typeId: "minecraft:diamond_axe", enchantments: [{ id: "silk_touch", level: 1 }] })];
  assert.equal(pickBestTool("leaf", "collect", onlySilkAxe), 0); // 任意精准工具
  const onlyShears: ToolItem[] = [item({ typeId: "minecraft:shears" })];
  assert.equal(pickBestTool("leaf", "collect", onlyShears), 0);
});

test("pickBestTool：空背包 / 无匹配 → undefined（不换工具）", () => {
  assert.equal(pickBestTool("log", "logs", []), undefined);
  assert.equal(pickBestTool("leaf", "collect", []), undefined);
  // 砍圆木但背包只有剪刀 → 无斧头可换
  assert.equal(pickBestTool("log", "logs", [item({ typeId: "minecraft:shears" })]), undefined);
});

test("pickBestTool BUG2 回归：杂物兜底 axe 不挤掉真斧头；主手已最优不倒腾", () => {
  // 背包全是非工具杂物（泥土/圆木——toolCategoryOf 兜底归 axe，score 0 分）
  // + 一把铁斧：必须选到真斧头（slot 3），绝不让 0 分杂物当选
  const junkAndAxe: ToolItem[] = [
    item({ slot: 0, typeId: "minecraft:dirt", category: "axe" }), // 兜底 axe 的杂物
    item({ slot: 1, typeId: "minecraft:oak_log", category: "axe" }), // 圆木杂物
    item({ slot: 2, typeId: "minecraft:bread", category: "axe" }), // 食物杂物
    item({ slot: 3, typeId: "minecraft:iron_axe", category: "axe" }),
  ];
  assert.equal(pickBestTool("log", "logs", junkAndAxe), 3);

  // 只有杂物（无任何 _axe 后缀）→ undefined（用当前主手，不换）
  const onlyJunk: ToolItem[] = [
    item({ slot: 0, typeId: "minecraft:dirt", category: "axe" }),
    item({ slot: 1, typeId: "minecraft:oak_log", category: "axe" }),
  ];
  assert.equal(pickBestTool("log", "logs", onlyJunk), undefined);

  // 主手已是最优（斧头在主手槽 4）→ undefined 不折腾（防换装倒腾：
  // 斧头入主手后再次选优指向主手槽自身 → setMainhandSlot 抛无效槽位被吞）
  const axeInHand: ToolItem[] = [
    item({ slot: 2, typeId: "minecraft:stone_axe", category: "axe" }),
    item({ slot: 4, typeId: "minecraft:diamond_axe", category: "axe" }),
  ];
  assert.equal(pickBestTool("log", "logs", axeInHand, 4), undefined);
  // 主手是次优（石斧在主手槽 2）→ 换钻石斧（slot 4）
  assert.equal(pickBestTool("log", "logs", axeInHand, 2), 4);

  // 树叶策略同款甄别：杂物（无锄/剪/精准特征）不参与树叶候选
  const leafJunkAndShears: ToolItem[] = [
    item({ slot: 0, typeId: "minecraft:dirt", category: "axe" }),
    item({ slot: 1, typeId: "minecraft:shears" }),
  ];
  assert.equal(pickBestTool("leaf", "collect", leafJunkAndShears), 1);
});
