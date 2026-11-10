// ─── 域规则单测（挖掘候选/机械节拍常量） ──────────────────

import test from "node:test";
import assert from "node:assert/strict";

import {
  isMineCandidate,
  toolStrategyForBlock,
  MINE_SWING_TICKS,
  PLACE_INTERVAL_TICKS,
  ATTACK_INTERVAL_TICKS,
  IDLE_RECHECK_TICKS,
} from "../scripts/domain/MineRules";
import {
  pickToolSlot,
  toolCategoryOf,
  toolStrategyLabel,
  scorePickaxe,
  type ToolItem,
} from "../scripts/domain/HarvestRules";

test("挖掘候选：技术方块/空气/液体全拒（归档死循环防线——不可破格不得入队）", () => {
  for (const id of [
    "minecraft:bedrock",
    "minecraft:barrier",
    "minecraft:air",
    "minecraft:cave_air",
    "minecraft:water",
    "minecraft:lava",
    "minecraft:command_block",
    "minecraft:structure_void",
    "minecraft:moving_block",
    "minecraft:end_portal_frame",
  ]) {
    assert.equal(isMineCandidate(id), false, id);
  }
  assert.equal(isMineCandidate("minecraft:light_block"), false);
  assert.equal(isMineCandidate("minecraft:light_block_7"), false); // 遗留拆分 id 前缀防线
});

test("挖掘候选：可摧毁方块全收——含植被（归档无候选过滤，可破即破；用户规格 2026-09-27 永不停机）", () => {
  for (const id of [
    "minecraft:stone",
    "minecraft:cobblestone",
    "minecraft:deepslate",
    "minecraft:obsidian",
    "minecraft:dirt",
    "minecraft:oak_log",
    "minecraft:gravel",
    "minecraft:grass",
    "minecraft:deadbush",
    "minecraft:tall_grass",
    "minecraft:coral_fan",
  ]) {
    assert.equal(isMineCandidate(id), true, id);
  }
});

test("机械节拍常量逐动作写死：挖掘 2 GT、放置发起间隔 3 GT（整周期 4 tick/块）、攻击 8 GT", () => {
  assert.equal(MINE_SWING_TICKS, 2);
  assert.equal(PLACE_INTERVAL_TICKS, 3);
  assert.equal(ATTACK_INTERVAL_TICKS, 8);
});

test("归档节拍常量：idle 重探 10t（归档 mine idleRecheckTicks 实测）", () => {
  assert.equal(IDLE_RECHECK_TICKS, 10);
});

// ─── 挖掘按方块选工具 ──

test("方块→工具策略：叶/木/石矿/土族归位，sandstone 优先判镐，未知方块 undefined 保持主手", () => {
  assert.equal(toolStrategyForBlock("minecraft:oak_leaves"), "leaf");
  assert.equal(toolStrategyForBlock("minecraft:oak_log"), "axe");
  assert.equal(toolStrategyForBlock("minecraft:spruce_planks"), "axe");
  assert.equal(toolStrategyForBlock("minecraft:stone"), "pickaxe");
  assert.equal(toolStrategyForBlock("minecraft:cobblestone"), "pickaxe");
  assert.equal(toolStrategyForBlock("minecraft:deepslate"), "pickaxe");
  assert.equal(toolStrategyForBlock("minecraft:iron_ore"), "pickaxe");
  assert.equal(toolStrategyForBlock("minecraft:obsidian"), "pickaxe");
  assert.equal(toolStrategyForBlock("minecraft:sandstone"), "pickaxe"); // 镐先于铲，不被 "sand" 误判
  assert.equal(toolStrategyForBlock("minecraft:dirt"), "shovel");
  assert.equal(toolStrategyForBlock("minecraft:grass_block"), "shovel");
  assert.equal(toolStrategyForBlock("minecraft:gravel"), "shovel");
  assert.equal(toolStrategyForBlock("minecraft:sand"), "shovel");
  assert.equal(toolStrategyForBlock("minecraft:modpack_mystery_gizmo"), undefined);
});

test("镐类别识别与评分：_pickaxe 归 pickaxe，品阶优先于附魔，非镐不入选", () => {
  assert.equal(toolCategoryOf("minecraft:diamond_pickaxe"), "pickaxe");
  const stone: ToolItem = {
    slot: 0,
    typeId: "minecraft:stone_pickaxe",
    enchantments: [],
    category: "pickaxe",
  };
  const effDiamond: ToolItem = {
    slot: 1,
    typeId: "minecraft:diamond_pickaxe",
    enchantments: [{ id: "efficiency", level: 1 }],
    category: "pickaxe",
  };
  assert.ok(scorePickaxe(effDiamond) > scorePickaxe(stone)); // 品阶(5) 压过石(2)，效率加分更甚
  assert.ok(scorePickaxe(stone) >= 0);
  const sword: ToolItem = { slot: 2, typeId: "minecraft:iron_sword", enchantments: [], category: "other" };
  assert.equal(scorePickaxe(sword), -1);
});

test("选工具耐久两段式：健康件优先，全告急兜底取告急件，无该策略返回 undefined", () => {
  const critical = { damage: 99, maxDurability: 100 }; // 剩 1 点=告急
  const healthy = { damage: 0, maxDurability: 100 };
  const brokenDiamond: ToolItem = {
    slot: 0,
    typeId: "minecraft:diamond_pickaxe",
    enchantments: [],
    category: "pickaxe",
    durability: critical,
  };
  const ironPick: ToolItem = {
    slot: 1,
    typeId: "minecraft:iron_pickaxe",
    enchantments: [],
    category: "pickaxe",
    durability: healthy,
  };
  // 健康铁镐 vs 告急钻石镐：健康优先（跨品阶兜底）
  assert.equal(pickToolSlot("pickaxe", [brokenDiamond, ironPick]), 1);
  // 只有告急件：兜底取它（绝不徒手）
  assert.equal(pickToolSlot("pickaxe", [brokenDiamond]), 0);
  // 无该策略工具（全是斧）：undefined=保持主手
  const axe: ToolItem = {
    slot: 5,
    typeId: "minecraft:oak_axe",
    enchantments: [],
    category: "axe",
    durability: healthy,
  };
  assert.equal(pickToolSlot("pickaxe", [axe]), undefined);
});

test("工具策略中文名：镐/斧/铲/锄剪（无工具报警文案用）", () => {
  assert.equal(toolStrategyLabel("pickaxe"), "镐");
  assert.equal(toolStrategyLabel("axe"), "斧");
  assert.equal(toolStrategyLabel("shovel"), "铲");
  assert.equal(toolStrategyLabel("leaf"), "锄或剪");
});
