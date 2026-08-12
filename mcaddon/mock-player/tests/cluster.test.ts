// ─── core/coords — 聚集概率计算 ───────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeClusterProbabilities, sortByClusterProbability } from "../scripts/core/coords/Cluster";

test("单点：概率为 0", () => {
  assert.deepEqual(computeClusterProbabilities([{ x: 0, y: 0, z: 0 }], 10), [0]);
});

test("两点相邻：互相为唯一邻居，概率 1", () => {
  const probs = computeClusterProbabilities([{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }], 10);
  assert.deepEqual(probs, [1, 1]);
});

test("两点远离：概率 0", () => {
  const probs = computeClusterProbabilities([{ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }], 10);
  assert.deepEqual(probs, [0, 0]);
});

test("扎堆点概率高、孤立点概率低", () => {
  // A(0,0,0) B(2,0,0) C(4,0,0) 三连 + D(100,0,0) 孤立
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
  ];
  const probs = computeClusterProbabilities(points, 5);
  // 扎堆三人互邻（各 2 个邻居）/ 3 = 2/3；孤立点 0
  assert.deepEqual(probs, [2 / 3, 2 / 3, 2 / 3, 0]);
});

test("两簇分离：簇内高、簇间不串", () => {
  // 簇1: A,B（距离 2）；簇2: C,D（距离 3）；簇间距 50
  const points = [
    { x: 0, y: 0, z: 0 },   // A
    { x: 2, y: 0, z: 0 },   // B
    { x: 50, y: 0, z: 0 },  // C
    { x: 53, y: 0, z: 0 },  // D
  ];
  const probs = computeClusterProbabilities(points, 10);
  assert.deepEqual(probs, [1 / 3, 1 / 3, 1 / 3, 1 / 3]);
});

test("半径边界：距离恰等于 radius 算邻居（<=）", () => {
  const probs = computeClusterProbabilities([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 10);
  assert.deepEqual(probs, [1, 1]);
});

test("空数组：返回空", () => {
  assert.deepEqual(computeClusterProbabilities([], 10), []);
});

test("sortByClusterProbability：按概率降序 + 坐标保留", () => {
  const points = [
    { x: 100, y: 0, z: 0 }, // 孤立 D
    { x: 0, y: 0, z: 0 },   // 扎堆 A
    { x: 2, y: 0, z: 0 },   // 扎堆 B
    { x: 4, y: 0, z: 0 },   // 扎堆 C
  ];
  const sorted = sortByClusterProbability(points, 5);
  assert.deepEqual(
    sorted.map((p) => p.index),
    [1, 2, 3, 0] // A/B/C（概率 2/3）在前，D（0）最后
  );
  assert.equal(sorted[0]!.probability, 2 / 3);
  assert.equal(sorted[3]!.probability, 0);
  assert.deepEqual(sorted[0]!.pos, { x: 0, y: 0, z: 0 });
});

test("sortByClusterProbability：概率相同时按原始下标升序（稳定）", () => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 50, y: 0, z: 0 },
  ];
  const sorted = sortByClusterProbability(points, 10);
  assert.deepEqual(sorted.map((p) => p.index), [0, 1]);
});

// ─── 边界条件 ─────────────────────────────────────────

test("边界：radius=0 时仅完全同坐标算邻居", () => {
  const probs = computeClusterProbabilities([
    { x: 1, y: 2, z: 3 },
    { x: 1, y: 2, z: 3 }, // 与 0 完全重叠
    { x: 1, y: 2, z: 4 }, // 距离 1 > 0
  ], 0);
  assert.deepEqual(probs, [1 / 2, 1 / 2, 0]);
});

test("边界：多点完全重叠（同一坐标）概率最高", () => {
  // 5 点全部重叠：互相都是邻居 → 概率 1
  const points = Array.from({ length: 5 }, () => ({ x: 7, y: 7, z: 7 }));
  const probs = computeClusterProbabilities(points, 10);
  assert.deepEqual(probs, [1, 1, 1, 1, 1]);
});

test("边界：负数 radius 等价 0（仅同坐标）", () => {
  const probs = computeClusterProbabilities([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ], -5);
  assert.equal(probs[0], 1 / 2);
  assert.equal(probs[2], 0);
});

test("边界：超大坐标差异不溢出（距离平方安全）", () => {
  const probs = computeClusterProbabilities([
    { x: 30000000, y: 0, z: 0 },
    { x: -30000000, y: 0, z: 0 },
  ], 10);
  assert.deepEqual(probs, [0, 0]);
});

test("边界：概率为 0 的孤立点排在扎堆点之后", () => {
  const sorted = sortByClusterProbability([
    { x: 1000, y: 1000, z: 1000 }, // 孤立（index 0）
    { x: 0, y: 0, z: 0 },          // 扎堆（index 1）
    { x: 2, y: 0, z: 0 },          // 扎堆（index 2）
  ], 5);
  assert.equal(sorted[0]!.index, 1);
  assert.equal(sorted[1]!.index, 2);
  assert.equal(sorted[2]!.index, 0);
  assert.equal(sorted[2]!.probability, 0);
});