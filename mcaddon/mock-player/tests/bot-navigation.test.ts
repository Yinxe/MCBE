// ─── core/bot — 导航纯逻辑（距离/到达/超时） ─────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { distance, isArrived, isTimedOut } from "../scripts/core/bot/Navigation";

test("distance：3D 欧氏距离", () => {
  assert.equal(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
  assert.equal(distance({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }), 0);
  assert.equal(distance({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }), Math.sqrt(3));
});

test("isArrived：距离 ≤ 阈值判定到达（含边界）", () => {
  assert.equal(isArrived(1.5, 1.5), true);
  assert.equal(isArrived(1.4, 1.5), true);
  assert.equal(isArrived(1.6, 1.5), false);
});

test("isTimedOut：累计推进 ≥ 超时阈值判定超时", () => {
  assert.equal(isTimedOut(599, 600), false);
  assert.equal(isTimedOut(600, 600), true);
  assert.equal(isTimedOut(601, 600), true);
});
