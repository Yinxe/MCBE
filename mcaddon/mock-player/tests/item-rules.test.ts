// ─── core/items — 物品规则（装备槽/可穿戴判定） ─────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { getEquipmentSlot, isWearableItem } from "../scripts/rules/items/ItemRules";

test("getEquipmentSlot：护甲后缀判定", () => {
  assert.equal(getEquipmentSlot("minecraft:diamond_helmet"), "head");
  assert.equal(getEquipmentSlot("minecraft:netherite_chestplate"), "chest");
  assert.equal(getEquipmentSlot("minecraft:iron_leggings"), "legs");
  assert.equal(getEquipmentSlot("minecraft:golden_boots"), "feet");
});

test("getEquipmentSlot：鞘翅/南瓜/头颅特殊判定", () => {
  assert.equal(getEquipmentSlot("minecraft:elytra"), "chest");
  assert.equal(getEquipmentSlot("minecraft:carved_pumpkin"), "head");
  assert.equal(getEquipmentSlot("minecraft:zombie_head"), "head");
  assert.equal(getEquipmentSlot("minecraft:skeleton_skull"), "head");
  assert.equal(getEquipmentSlot("minecraft:dragon_head"), "head");
});

test("getEquipmentSlot：非装备返回 undefined", () => {
  assert.equal(getEquipmentSlot("minecraft:diamond_sword"), undefined);
  assert.equal(getEquipmentSlot("minecraft:diamond"), undefined);
  assert.equal(getEquipmentSlot("minecraft:stick"), undefined);
});

test("isWearableItem：与 getEquipmentSlot 判定一致", () => {
  assert.ok(isWearableItem("minecraft:elytra"));
  assert.ok(isWearableItem("minecraft:leather_helmet"));
  assert.ok(!isWearableItem("minecraft:arrow"));
});