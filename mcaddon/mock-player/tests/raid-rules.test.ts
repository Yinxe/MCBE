// ─── core/service — 劫掠规则 ───────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OMINOUS_BOTTLE_ID, BAD_OMEN, RAID_OMEN, VILLAGE_HERO, DRINK_DURATION, RAID_STUCK_TICKS,
  isOminousBottle, classifyRaidEffect,
} from "../scripts/core/service/RaidRules";

test("常量：效果 ID 精确值", () => {
  assert.equal(OMINOUS_BOTTLE_ID, "minecraft:ominous_bottle");
  assert.equal(BAD_OMEN, "minecraft:bad_omen");
  assert.equal(RAID_OMEN, "minecraft:raid_omen");
  assert.equal(VILLAGE_HERO, "minecraft:village_hero");
  assert.equal(DRINK_DURATION, 32);
  assert.equal(RAID_STUCK_TICKS, 1200);
});

test("isOminousBottle：精确匹配", () => {
  assert.ok(isOminousBottle("minecraft:ominous_bottle"));
  assert.ok(!isOminousBottle("minecraft:potion"));
  assert.ok(!isOminousBottle("ominous_bottle")); // 无前缀不匹配（API typeId 恒带前缀）
});

test("classifyRaidEffect：三种效果分类", () => {
  assert.equal(classifyRaidEffect(BAD_OMEN), "bad-omen");
  assert.equal(classifyRaidEffect(RAID_OMEN), "raid-omen");
  assert.equal(classifyRaidEffect(VILLAGE_HERO), "village-hero");
});

test("classifyRaidEffect：无关效果返回 undefined", () => {
  assert.equal(classifyRaidEffect("minecraft:speed"), undefined);
  assert.equal(classifyRaidEffect(""), undefined);
  assert.equal(classifyRaidEffect("bad_omen"), undefined); // 缺前缀
});