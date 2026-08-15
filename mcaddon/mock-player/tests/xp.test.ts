// ─── core/xp — 经验公式 ───────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { getTotalXpForLevels, buildExperienceRecord } from "../scripts/rules/XpMath";

test("getTotalXpForLevels：0 级为 0", () => {
  assert.equal(getTotalXpForLevels(0), 0);
});

test("getTotalXpForLevels：1 级 = 7 XP（0 级升 1 级 2*0+7）", () => {
  assert.equal(getTotalXpForLevels(1), 7);
});

test("getTotalXpForLevels：15 级 = 315 XP（0-14 级区间求和）", () => {
  // Σ(2n+7), n=0..14 = 2*105 + 7*15 = 210 + 105 = 315
  assert.equal(getTotalXpForLevels(15), 315);
});

test("getTotalXpForLevels：16 级 = 315 + 42（15 级升 16 级需 5*15-38=37）", () => {
  // 15→16 级：5n-38 当 n=15 → 75-38=37 → 315+37=352
  assert.equal(getTotalXpForLevels(16), 352);
});

test("getTotalXpForLevels：30 级 = 1395 XP（已知官方值）", () => {
  // 0-15 段 315 + 16-30 段：Σ(5n-38) n=15..29 = 5*330 - 38*15 = 1650-570=1080 → 1395
  assert.equal(getTotalXpForLevels(30), 1395);
});

test("getTotalXpForLevels：31 级进入 9n-158 段（30→31 需 112）", () => {
  const at30 = getTotalXpForLevels(30);
  const at31 = getTotalXpForLevels(31);
  assert.equal(at31 - at30, 9 * 30 - 158);
});

test("buildExperienceRecord：等级+进度合成 totalXp", () => {
  const exp = buildExperienceRecord(30, 100);
  assert.deepEqual(exp, { level: 30, xpProgress: 100, totalXp: getTotalXpForLevels(30) + 100 });
});