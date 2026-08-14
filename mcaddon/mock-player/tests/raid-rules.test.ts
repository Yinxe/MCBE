// ─── core/tasks — 劫掠规则（内聚在劫掠任务） ─────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OMINOUS_BOTTLE_ID, BAD_OMEN, RAID_OMEN, VILLAGE_HERO, DRINK_DURATION,
  RAIDER_TYPE_IDS, RAID_LEAVE_RADIUS, RAID_WAVE_COOLDOWN_TICKS, RAID_TRUCE_TICKS,
  WAVE_COUNTS_BY_DIFFICULTY, raidWaveCount,
  isOminousBottle, classifyRaidEffect,
} from "../scripts/core/tasks/RaidRules";

test("常量：效果 ID 精确值", () => {
  assert.equal(OMINOUS_BOTTLE_ID, "minecraft:ominous_bottle");
  assert.equal(BAD_OMEN, "minecraft:bad_omen");
  assert.equal(RAID_OMEN, "minecraft:raid_omen");
  assert.equal(VILLAGE_HERO, "minecraft:village_hero");
  // 饮用时长 40 tick（2 秒）：比消耗所需 32 tick 多 ~8 tick 余量，防调度抖动导致药水没喝完
  assert.equal(DRINK_DURATION, 40);
});

test("常量：袭击波次机制（wiki 核对）", () => {
  // 袭击者加入/退出半径 96/112；波间冷却 15 秒（300 tick）；停战 40 分钟（48000 tick）
  assert.equal(RAID_LEAVE_RADIUS, 112);
  assert.equal(RAID_WAVE_COOLDOWN_TICKS, 300);
  assert.equal(RAID_TRUCE_TICKS, 48000);
  // 总波数由难度决定：简单 3 / 普通 5 / 困难 7（基岩版与袭击之兆等级无关）
  assert.deepEqual(WAVE_COUNTS_BY_DIFFICULTY, { peaceful: 0, easy: 3, normal: 5, hard: 7 });
  assert.equal(raidWaveCount("easy"), 3);
  assert.equal(raidWaveCount("normal"), 5);
  assert.equal(raidWaveCount("hard"), 7);
  assert.equal(raidWaveCount("unknown"), 5); // 未知难度兜底普通
});

test("常量：袭击参与生物 typeId 列表（wiki 波次表核对）", () => {
  assert.deepEqual([...RAIDER_TYPE_IDS], [
    "minecraft:pillager",
    "minecraft:vindicator",
    "minecraft:evocation_illager",
    "minecraft:ravager",
    "minecraft:witch",
  ]);
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