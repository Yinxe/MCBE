// ─── 挖掘工具规则单测（rules/items/MineToolRules） ──────
// 方块 → 工具类别映射 + 评分选优（纯函数，node 直测）

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mineToolCategoryOf,
  pickBestMineTool,
  pickBestWeapon,
  scoreMineTool,
  scoreWeapon,
  type MineToolEntry,
} from "../scripts/rules/items/MineToolRules";

/** 构造工具条目（便捷工厂；附魔默认空） */
function tool(slot: number, typeId: string, enchantments: MineToolEntry["enchantments"] = []): MineToolEntry {
  return { slot, typeId, enchantments };
}

describe("mineToolCategoryOf（方块 → 工具类别映射）", () => {
  it("石质/矿物 → 镐", () => {
    assert.equal(mineToolCategoryOf("minecraft:stone"), "pickaxe");
    assert.equal(mineToolCategoryOf("minecraft:deepslate_diamond_ore"), "pickaxe");
    assert.equal(mineToolCategoryOf("minecraft:cobblestone"), "pickaxe");
    assert.equal(mineToolCategoryOf("minecraft:obsidian"), "pickaxe");
  });
  it("木质 → 斧", () => {
    assert.equal(mineToolCategoryOf("minecraft:oak_log"), "axe");
    assert.equal(mineToolCategoryOf("minecraft:oak_planks"), "axe");
    assert.equal(mineToolCategoryOf("minecraft:crafting_table"), "axe");
  });
  it("土质/沙质 → 锹", () => {
    assert.equal(mineToolCategoryOf("minecraft:dirt"), "shovel");
    assert.equal(mineToolCategoryOf("minecraft:grass_block"), "shovel");
    assert.equal(mineToolCategoryOf("minecraft:sand"), "shovel");
    assert.equal(mineToolCategoryOf("minecraft:gravel"), "shovel");
  });
  it("蛛网 → 剑", () => {
    assert.equal(mineToolCategoryOf("minecraft:cobweb"), "sword");
  });
  it("未映射类型 → undefined（不折腾换装）", () => {
    assert.equal(mineToolCategoryOf("minecraft:torch"), undefined);
    assert.equal(mineToolCategoryOf("minecraft:unknown_block"), undefined);
  });
});

describe("scoreMineTool（评分器）", () => {
  it("品阶优先：钻石镐 > 铁镐 > 石镐", () => {
    const stone = tool(1, "minecraft:stone_pickaxe");
    const iron = tool(2, "minecraft:iron_pickaxe");
    const diamond = tool(3, "minecraft:diamond_pickaxe");
    assert.ok(scoreMineTool(diamond, "pickaxe") > scoreMineTool(iron, "pickaxe"));
    assert.ok(scoreMineTool(iron, "pickaxe") > scoreMineTool(stone, "pickaxe"));
  });
  it("非指定类别 → -1 不参与", () => {
    const axe = tool(1, "minecraft:diamond_axe");
    assert.equal(scoreMineTool(axe, "pickaxe"), -1);
    const pickaxe = tool(2, "minecraft:diamond_pickaxe");
    assert.equal(scoreMineTool(pickaxe, "axe"), -1);
  });
  it("效率附魔加分", () => {
    const plain = tool(1, "minecraft:iron_pickaxe");
    const eff = tool(2, "minecraft:iron_pickaxe", [{ id: "efficiency", level: 3 }]);
    assert.ok(scoreMineTool(eff, "pickaxe") > scoreMineTool(plain, "pickaxe"));
  });
});

describe("pickBestMineTool（选最优槽位）", () => {
  it("返回最高评分工具槽位", () => {
    const items = [
      tool(2, "minecraft:stone_pickaxe"),
      tool(5, "minecraft:diamond_pickaxe"),
      tool(8, "minecraft:iron_pickaxe"),
    ];
    assert.equal(pickBestMineTool("minecraft:stone", items, 0), 5);
  });
  it("主手已是最优 → undefined 不折腾", () => {
    const items = [
      tool(2, "minecraft:stone_pickaxe"),
      tool(5, "minecraft:diamond_pickaxe"),
    ];
    assert.equal(pickBestMineTool("minecraft:stone", items, 5), undefined);
  });
  it("未映射方块 → undefined", () => {
    const items = [tool(2, "minecraft:diamond_pickaxe")];
    assert.equal(pickBestMineTool("minecraft:torch", items, 0), undefined);
  });
  it("无匹配工具 → undefined（用当前主手）", () => {
    const items = [tool(2, "minecraft:diamond_axe")]; // 目标要镐
    assert.equal(pickBestMineTool("minecraft:stone", items, 0), undefined);
  });
});

describe("scoreWeapon / pickBestWeapon（攻击武器）", () => {
  it("同品阶剑 > 斧（攻速优势）", () => {
    const sword = tool(1, "minecraft:iron_sword");
    const axe = tool(2, "minecraft:iron_axe");
    assert.ok(scoreWeapon(sword) > scoreWeapon(axe));
  });
  it("锋利附魔加分", () => {
    const plain = tool(1, "minecraft:iron_sword");
    const sharp = tool(2, "minecraft:iron_sword", [{ id: "sharpness", level: 3 }]);
    assert.ok(scoreWeapon(sharp) > scoreWeapon(plain));
  });
  it("非武器 → -1 不参与", () => {
    const pickaxe = tool(1, "minecraft:diamond_pickaxe");
    assert.equal(scoreWeapon(pickaxe), -1);
  });
  it("pickBestWeapon 返回最优剑槽位；主手已最优 undefined", () => {
    const items = [
      tool(2, "minecraft:stone_axe"),
      tool(5, "minecraft:diamond_sword"),
    ];
    assert.equal(pickBestWeapon(items, 0), 5);
    assert.equal(pickBestWeapon(items, 5), undefined);
  });
});
