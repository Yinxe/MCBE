import { test } from "node:test";
import assert from "node:assert/strict";
import { boxFromArea } from "../scripts/core/model/BoxShape";

test("BoxShape: 中心不偏半格（框住方块本体，非坐标点）", () => {
  // 单格仓库 (0,0,0)-(0,0,0)：块占 [0,1)，中心应在 0.5
  const box = boxFromArea({ dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 0, y: 0, z: 0 } });
  assert.deepEqual(box.center, { x: 0.5, y: 0.5, z: 0.5 });
  assert.deepEqual(box.size, { x: 1, y: 1, z: 1 });
});

test("BoxShape: 两格跨度边长 2、中心 1", () => {
  // (0)-(1)：块占 [0,2)，中心 1，边长 2
  const box = boxFromArea({ dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 1, y: 1, z: 1 } });
  assert.deepEqual(box.center, { x: 1, y: 1, z: 1 });
  assert.deepEqual(box.size, { x: 2, y: 2, z: 2 });
});

test("BoxShape: 乱序角点自动纠正，结果与正序一致", () => {
  const forward = boxFromArea({ dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 5, z: 20 } });
  const reversed = boxFromArea({ dimension: "overworld", corner1: { x: 10, y: 5, z: 20 }, corner2: { x: 0, y: 0, z: 0 } });
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward.size, { x: 11, y: 6, z: 21 });
  assert.deepEqual(forward.center, { x: 5.5, y: 3, z: 10.5 });
});

test("BoxShape: 负坐标同样按方块本体外表面计算", () => {
  const box = boxFromArea({ dimension: "overworld", corner1: { x: -2, y: -1, z: -3 }, corner2: { x: -2, y: -1, z: -3 } });
  assert.deepEqual(box.center, { x: -1.5, y: -0.5, z: -2.5 });
  assert.deepEqual(box.size, { x: 1, y: 1, z: 1 });
});

test("BoxShape: min/max 保留归一化角点", () => {
  const box = boxFromArea({ dimension: "overworld", corner1: { x: 5, y: 3, z: 1 }, corner2: { x: 1, y: 9, z: 7 } });
  assert.deepEqual(box.min, { x: 1, y: 3, z: 1 });
  assert.deepEqual(box.max, { x: 5, y: 9, z: 7 });
});
