// ─── core/items — 工具规则（识别/耐久/槽位搜索） ───────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  identifyTool, isToolHealthy, findReplacementIndex, findEmptySlotIndex, findAnySlot,
  HEALTH_PERCENT_THRESHOLD, HEALTH_ABSOLUTE_THRESHOLD,
} from "../scripts/rules/items/ToolRules";

test("identifyTool：后缀模式识别", () => {
  assert.equal(identifyTool("minecraft:diamond_pickaxe")?.label, "镐");
  assert.equal(identifyTool("minecraft:netherite_sword")?.label, "剑");
  assert.equal(identifyTool("minecraft:wooden_hoe")?.label, "锄");
  assert.equal(identifyTool("minecraft:iron_shovel")?.label, "锹");
  assert.equal(identifyTool("minecraft:stone_axe")?.label, "斧");
});

test("identifyTool：特殊物品识别", () => {
  assert.equal(identifyTool("minecraft:fishing_rod")?.label, "钓鱼竿");
  assert.equal(identifyTool("minecraft:trident")?.label, "三叉戟");
  assert.equal(identifyTool("minecraft:shears")?.label, "剪刀");
});

test("identifyTool：非工具返回 undefined（防御 _sword 前缀不误判）", () => {
  assert.equal(identifyTool("minecraft:diamond"), undefined);
  assert.equal(identifyTool("minecraft:red_sword_plant"), undefined);
});

test("isToolHealthy：非耐久物品（无 damage）健康", () => {
  assert.equal(isToolHealthy(undefined, undefined, undefined), true);
});

test("isToolHealthy：不可破坏物品健康", () => {
  assert.equal(isToolHealthy(5, 100, true), true);
});

test("isToolHealthy：耐久充足健康", () => {
  assert.equal(isToolHealthy(10, 100, false), true);
});

test("isToolHealthy：百分比阈值触发（< 5%）", () => {
  // damage 96/100 → 剩余 4% < 5%
  assert.equal(isToolHealthy(96, 100, false), false);
});

test("isToolHealthy：绝对值阈值触发（剩余 < 10）", () => {
  // 木剑 maxDurability 60，damage 55 → 剩余 5 < 10
  assert.equal(isToolHealthy(55, 60, false), false);
});

test("isToolHealthy：阈值常量与实现一致", () => {
  assert.equal(HEALTH_PERCENT_THRESHOLD, 5);
  assert.equal(HEALTH_ABSOLUTE_THRESHOLD, 10);
});

test("findReplacementIndex：找到同类健康工具", () => {
  const items = [
    { typeId: "minecraft:iron_pickaxe", healthy: true },
    null,
    { typeId: "minecraft:iron_pickaxe", healthy: true },
  ];
  const idx = findReplacementIndex(items, "minecraft:iron_pickaxe", 0, (i) => i.healthy);
  assert.equal(idx, 2);
});

test("findReplacementIndex：跳过自己槽位 / 只认同类", () => {
  const items = [
    { typeId: "minecraft:iron_pickaxe", healthy: false },
    { typeId: "minecraft:stone_pickaxe", healthy: true },
    { typeId: "minecraft:iron_pickaxe", healthy: true },
    { typeId: "minecraft:iron_axe", healthy: true },
  ];
  // 排除 slot0（自身）+ 非同类（slot1/3），命中 slot2
  const idx = findReplacementIndex(items, "minecraft:iron_pickaxe", 0, (i) => i.healthy);
  assert.equal(idx, 2);
});

test("findReplacementIndex：无健康同类返回 undefined", () => {
  const items = [
    { typeId: "minecraft:iron_pickaxe", healthy: false },
    { typeId: "minecraft:iron_pickaxe", healthy: false },
  ];
  assert.equal(findReplacementIndex(items, "minecraft:iron_pickaxe", 0, (i) => i.healthy), undefined);
});

test("findEmptySlotIndex：找到首个空槽（排除排除槽位）", () => {
  const items = ["a", null, "b", null];
  assert.equal(findEmptySlotIndex(items, 0), 1);
  assert.equal(findEmptySlotIndex(items, 1), 3);
});

test("findEmptySlotIndex：无空槽返回 undefined", () => {
  assert.equal(findEmptySlotIndex(["a", "b"], 0), undefined);
});

test("findAnySlot：返回首个非排除槽位", () => {
  assert.equal(findAnySlot(0, 36), 1);
  assert.equal(findAnySlot(35, 36), 0);
});