// ─── 跟随规则单测（domain/FollowRules）：跟随距离三档判定与常量锚定 ────
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOW_MAX_DIST, FOLLOW_STOP_DIST, FOLLOW_TICK, classifyFollowGap } from "../scripts/domain/FollowRules";

test("跟随常量对齐归档口径（10t 节拍 / 3 停 / 128 断关系线）", () => {
  assert.equal(FOLLOW_TICK, 10);
  assert.equal(FOLLOW_STOP_DIST, 3);
  assert.equal(FOLLOW_MAX_DIST, 128);
});

test("入带下限：≤3 停走（归档无死区，每拍 stopMoving）", () => {
  assert.equal(classifyFollowGap(2.9), "stop");
  assert.equal(classifyFollowGap(3), "stop");
});

test("行走带 (3,128]：>3 即走，恰 128 仍在界内（归档无滞回记忆）", () => {
  assert.equal(classifyFollowGap(3.1), "walk");
  assert.equal(classifyFollowGap(4), "walk", "3~5 区间不再是滞回死区——异3 回归归档");
  assert.equal(classifyFollowGap(128), "walk");
});

test("出带上限 >128 → 断关系（归档文案『距离目标过远，停止跟随』）", () => {
  assert.equal(classifyFollowGap(128.1), "release");
  assert.equal(classifyFollowGap(9999), "release");
});
