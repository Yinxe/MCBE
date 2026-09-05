// ─── core/rules/woodcut — 砍树模式与工具策略（WoodcutRules） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHOP_MODE_LABEL,
  materialTier,
  normalizeChopMode,
} from "../scripts/rules/woodcut/WoodcutRules";

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



test("materialTier：品阶排序（wood<stone<iron<gold<diamond<netherite）", () => {
  assert.equal(materialTier("minecraft:wooden_axe"), 1);
  assert.equal(materialTier("minecraft:stone_axe"), 2);
  assert.equal(materialTier("minecraft:iron_axe"), 3);
  assert.equal(materialTier("minecraft:golden_axe"), 4);
  assert.equal(materialTier("minecraft:diamond_axe"), 5);
  assert.equal(materialTier("minecraft:netherite_axe"), 6);
  assert.equal(materialTier("minecraft:shears"), 0); // shears 无材质
});






