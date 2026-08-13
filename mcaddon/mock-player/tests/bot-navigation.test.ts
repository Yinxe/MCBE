// ─── core/bot — 导航纯逻辑（距离/到达/超时） ─────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { distance, isArrived, isTimedOut, standSpotCandidates, findStandSpot, nearestPoint } from "../scripts/core/bot/Navigation";

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

test("standSpotCandidates：水平 4 向距离 1/2 优先 + 对角兜底", () => {
  const cands = standSpotCandidates({ x: 5, y: 0, z: 5 });
  assert.equal(cands.length, 12);
  // 距离 1：x±1 与 z±1 交替
  assert.deepEqual(cands[0], { x: 4, y: 0, z: 5 });
  assert.deepEqual(cands[1], { x: 5, y: 0, z: 4 });
  assert.deepEqual(cands[2], { x: 6, y: 0, z: 5 });
  assert.deepEqual(cands[3], { x: 5, y: 0, z: 6 });
  // 距离 2：同样交替
  assert.deepEqual(cands[4], { x: 3, y: 0, z: 5 });
  assert.deepEqual(cands[5], { x: 5, y: 0, z: 3 });
  // 对角 4 向兜底
  assert.deepEqual(cands[8], { x: 4, y: 0, z: 4 });
  assert.deepEqual(cands[11], { x: 6, y: 0, z: 6 });
});

test("findStandSpot：首个可站立候选（谓词注入）+ 全部不可站返回 undefined", () => {
  const can = (pos: { x: number; y: number; z: number }) => pos.x === 5 && pos.z === 6;
  assert.deepEqual(findStandSpot({ x: 5, y: 0, z: 5 }, can), { x: 5, y: 0, z: 6 });
  assert.equal(findStandSpot({ x: 0, y: 0, z: 0 }, () => false), undefined);
});

test("nearestPoint：取最近点 / 空集 undefined", () => {
  const center = { x: 0, y: 0, z: 0 };
  const points = [
    { x: 10, y: 0, z: 0 },
    { x: 3, y: 0, z: 4 },
    { x: 5, y: 0, z: 0 },
  ];
  assert.deepEqual(nearestPoint(center, points), { x: 3, y: 0, z: 4 });
  assert.equal(nearestPoint(center, []), undefined);
});
