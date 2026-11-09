// ─── 方块偏好表单测（纯数据，node:test） ───────────────
// 覆盖 MinePreference：命中规则 → PreferenceSpec（两级偏好：附魔+工具）；未命中 →
// undefined（走默认策略）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupMineStrategy } from "../scripts/MinePreference";

test("lookupMineStrategy：农作物 → 时运优先（锄>任意，排除锹）", () => {
  const expect = {
    name: "crop-fortune",
    enchantChain: ["fortune"],
    toolChain: ["hoe", "*"],
    exclude: ["shovel"],
    strict: true,
    crossEnchant: true,
  };
  assert.deepEqual(lookupMineStrategy("minecraft:wheat"), expect);
  assert.deepEqual(lookupMineStrategy("minecraft:carrots"), expect);
  assert.deepEqual(lookupMineStrategy("minecraft:potatoes"), expect);
  assert.deepEqual(lookupMineStrategy("minecraft:beetroots"), expect);
});

test("lookupMineStrategy：草方块族 → 精准优先（锹>任意）", () => {
  const expect = { name: "grass-silk", enchantChain: ["silk"], toolChain: ["shovel", "*"], strict: true };
  assert.deepEqual(lookupMineStrategy("minecraft:grass_block"), expect);
  assert.deepEqual(lookupMineStrategy("minecraft:podzol"), expect);
  assert.deepEqual(lookupMineStrategy("minecraft:mycelium"), expect);
});

test("lookupMineStrategy：树叶 → 精准优先（锄>剪>任意精准）", () => {
  const expect = {
    name: "leaves-silk",
    enchantChain: ["silk"],
    toolChain: ["hoe", "shears", "*"],
    strict: true,
    crossEnchant: true,
  };
  assert.deepEqual(lookupMineStrategy("minecraft:oak_leaves"), expect);
  assert.deepEqual(lookupMineStrategy("minecraft:acacia_leaves"), expect);
});

test("lookupMineStrategy：玻璃/冰/萤石 → 精准优先（镐>任意）", () => {
  const expect = { name: "glass-silk", enchantChain: ["silk"], toolChain: ["pickaxe", "*"], strict: true };
  assert.deepEqual(lookupMineStrategy("minecraft:glass"), expect);
  assert.deepEqual(lookupMineStrategy("minecraft:ice"), expect);
  assert.deepEqual(lookupMineStrategy("minecraft:glowstone"), expect);
  assert.deepEqual(lookupMineStrategy("minecraft:sea_lantern"), expect);
});

test("lookupMineStrategy：未命中返回 undefined（走默认策略）", () => {
  assert.equal(lookupMineStrategy("minecraft:stone"), undefined);
  assert.equal(lookupMineStrategy("minecraft:diamond_ore"), undefined);
  assert.equal(lookupMineStrategy("minecraft:crafting_table"), undefined);
});
