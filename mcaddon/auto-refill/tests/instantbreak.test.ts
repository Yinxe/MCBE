// ─── 瞬破方块规则集单测（纯逻辑，node:test） ───────────
// 覆盖 suffix/exact 规则与"不误伤"边界（redstone_wire 含 stone、按钮含
// stone、jack_o_lantern 含 lantern——都不能触发工具识别）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { isInstantBreak } from "../scripts/InstantBreak";

test("suffix 规则：所有按钮/压力板变体 → 瞬破", () => {
  assert.equal(isInstantBreak("minecraft:oak_button"), true);
  assert.equal(isInstantBreak("minecraft:stone_button"), true);
  assert.equal(isInstantBreak("minecraft:polished_blackstone_button"), true);
  assert.equal(isInstantBreak("minecraft:stone_pressure_plate"), true);
  assert.equal(isInstantBreak("minecraft:light_weighted_pressure_plate"), true);
});

test("exact 规则：红石线/红石火把/南瓜灯 → 瞬破", () => {
  assert.equal(isInstantBreak("minecraft:redstone_wire"), true);
  assert.equal(isInstantBreak("minecraft:redstone_torch"), true);
  assert.equal(isInstantBreak("minecraft:jack_o_lantern"), true);
});

test("不误伤：含干扰词的需工具方块 → false", () => {
  // redstone_wire 会误匹配 stone、stone_button 会误匹配按钮关键词外的 stone——都不该判瞬破
  assert.equal(isInstantBreak("minecraft:stone"), false);
  assert.equal(isInstantBreak("minecraft:lantern"), false); // jack_o_lantern 含 lantern
  assert.equal(isInstantBreak("minecraft:redstone_block"), false);
  assert.equal(isInstantBreak("minecraft:oak_wall_sign"), false);
  assert.equal(isInstantBreak("minecraft:chest"), false);
});
