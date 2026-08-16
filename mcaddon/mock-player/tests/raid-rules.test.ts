// ─── core/tasks — 劫掠规则（事件驱动模块 features/raid/raidMode 的决策纯函数） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OMINOUS_BOTTLE_ID, BAD_OMEN, RAID_OMEN, VILLAGE_HERO, DRINK_DURATION, RAID_TRUCE_TICKS,
  isOminousBottle, classifyRaidEffect, canDrinkRaid, diagnoseRaidIdle,
} from "../scripts/rules/RaidRules";

test("常量：效果 ID 精确值", () => {
  assert.equal(OMINOUS_BOTTLE_ID, "minecraft:ominous_bottle");
  assert.equal(BAD_OMEN, "minecraft:bad_omen");
  assert.equal(RAID_OMEN, "minecraft:raid_omen");
  assert.equal(VILLAGE_HERO, "minecraft:village_hero");
  // 饮用时长 40 tick（2 秒）：比消耗所需 32 tick 多 ~8 tick 余量，防调度抖动导致药水没喝完
  assert.equal(DRINK_DURATION, 40);
  // 停战：袭击持续 40 分钟（48000 tick）未结束 → 平局中止
  assert.equal(RAID_TRUCE_TICKS, 48000);
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

// ─── 决策纯函数（事件驱动循环：开启/胜利后喝瓶 → 等袭击 → 胜利） ──

const clean = { badOmen: false, raidOmen: false };

test("canDrinkRaid：无兆头 + 有药水 + 未等待 → 可喝", () => {
  assert.ok(canDrinkRaid(clean, 1, false));
});

test("canDrinkRaid：任一兆头在 → 不可喝（袭击酝酿/进行中不重复喝）", () => {
  assert.ok(!canDrinkRaid({ badOmen: true, raidOmen: false }, 5, false));
  assert.ok(!canDrinkRaid({ badOmen: false, raidOmen: true }, 5, false));
});

test("canDrinkRaid：无药水 → 不可喝", () => {
  assert.ok(!canDrinkRaid(clean, 0, false));
});

test("canDrinkRaid：周期等待中 → 不可喝（本周期已喝过，兆头消失也不重复喝）", () => {
  assert.ok(!canDrinkRaid(clean, 5, true));
});

test("diagnoseRaidIdle：周期等待/袭击中 → 静默等待", () => {
  assert.equal(diagnoseRaidIdle(clean, 0, true), "waiting");
  assert.equal(diagnoseRaidIdle({ badOmen: true, raidOmen: false }, 0, false), "waiting");
  assert.equal(diagnoseRaidIdle({ badOmen: false, raidOmen: true }, 3, false), "waiting");
  assert.equal(diagnoseRaidIdle(clean, 3, false), "waiting"); // 有药水但不可喝 → 等事件
});

test("diagnoseRaidIdle：无兆头 + 无药水 + 未等待 → 缺瓶（通知）", () => {
  assert.equal(diagnoseRaidIdle(clean, 0, false), "no-bottle");
});