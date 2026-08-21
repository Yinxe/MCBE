// ─── core/format — 文本格式化与附魔映射 ───────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatDimensionId, levelToRoman } from "../scripts/rules/format/Format";
import { ENCH_ZH, enchantDisplayName, formatSerializedEnchantments } from "../scripts/rules/format/EnchantZh";
import { makeItem } from "./helpers/factories";

test("formatDimensionId：维度 ID → 中文", () => {
  assert.equal(formatDimensionId("minecraft:overworld"), "主世界");
  assert.equal(formatDimensionId("minecraft:nether"), "下界");
  assert.equal(formatDimensionId("minecraft:the_end"), "末地");
  assert.equal(formatDimensionId("minecraft:unknown"), "minecraft:unknown");
});

test("levelToRoman：1-10 罗马数字，>10 用 [n]", () => {
  assert.equal(levelToRoman(1), "I");
  assert.equal(levelToRoman(5), "V");
  assert.equal(levelToRoman(10), "X");
  assert.equal(levelToRoman(11), "[11]");
  assert.equal(levelToRoman(30), "[30]");
});

test("ENCH_ZH：核心附魔映射齐全", () => {
  assert.equal(ENCH_ZH["sharpness"], "锋利");
  assert.equal(ENCH_ZH["protection"], "保护");
  assert.equal(ENCH_ZH["mending"], "经验修补");
  assert.equal(ENCH_ZH["impaling"], "穿刺");
  assert.equal(enchantDisplayName("unknown_ench"), "unknown_ench");
});

test("formatSerializedEnchantments：无附魔返回空串", () => {
  assert.equal(formatSerializedEnchantments(makeItem("minecraft:diamond")), "");
});

test("formatSerializedEnchantments：中文 + 罗马等级", () => {
  const text = formatSerializedEnchantments(makeItem("minecraft:diamond_sword", 1, {
    enchantments: [
      { id: "sharpness", level: 5 },
      { id: "knockback", level: 2 },
    ],
  }));
  assert.equal(text, "锋利V 击退II");
});

test("formatSerializedEnchantments：等级 >10 用 [n]（统一 levelToRoman 行为）", () => {
  const text = formatSerializedEnchantments(makeItem("minecraft:stick", 1, {
    enchantments: [{ id: "unbreaking", level: 11 }],
  }));
  assert.equal(text, "耐久[11]");
});