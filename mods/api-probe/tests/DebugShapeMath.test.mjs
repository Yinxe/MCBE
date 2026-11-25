// ─── DebugShapeMath 单测:三色轴与尺寸文字的位置 ───────────────────
//
// 这层是纯函数(不依赖 @minecraft/debug-utilities),因此可以直接在 node 里跑。
// 重点验证三件事:
//   1. 三条轴都从最小角出发,沿各自轴向伸出
//   2. 轴长取 min(AXIS_MAX_LENGTH, 该轴边长),不越出盒子太多
//   3. 尺寸文字落在盒子上方一格的水平中心

import assert from "node:assert/strict";
import { test } from "node:test";
import { boxFromCorners } from "../lib/scripts/BoxGeometry.js";
import {
  AXIS_MAX_LENGTH,
  AXES,
  axisSegments,
  clampNumber,
  describeSize,
  labelPosition,
} from "../lib/scripts/DebugShapeMath.js";

/** 100 64 -20 → 109 71 -11:10×8×10 的盒子 */
const sampleBox = boxFromCorners({ x: 100, y: 64, z: -20 }, { x: 109, y: 71, z: -11 });

test("尺寸文字用 × 连接三个轴", () => {
  assert.equal(describeSize(sampleBox), "10×8×10");
});

test("三条轴覆盖 x/y/z 且都从最小角出发", () => {
  const segments = axisSegments(sampleBox);
  assert.deepEqual(
    segments.map((segment) => segment.axis),
    [...AXES]
  );
  for (const segment of segments) {
    assert.deepEqual(segment.start, sampleBox.min);
  }
});

test("轴只沿自己的轴变化,另外两轴不变", () => {
  for (const segment of axisSegments(sampleBox)) {
    for (const axis of AXES) {
      if (axis === segment.axis) continue;
      assert.equal(segment.end[axis], segment.start[axis], `${segment.axis} 轴不该改动 ${axis}`);
    }
    assert.equal(segment.end[segment.axis], segment.start[segment.axis] + segment.length);
  }
});

test("大盒子的轴长被上限截断", () => {
  const segments = axisSegments(sampleBox);
  for (const segment of segments) {
    // 10 / 8 / 10 都大于 AXIS_MAX_LENGTH(4),因此一律取上限
    assert.equal(segment.length, AXIS_MAX_LENGTH);
  }
});

test("小盒子的轴长跟随边长,不伸出盒子", () => {
  const tiny = boxFromCorners({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }); // 2×2×2
  for (const segment of axisSegments(tiny)) {
    assert.equal(segment.length, 2);
  }
});

test("单格选区的轴长也是 1,不会伸出到相邻方块", () => {
  const single = boxFromCorners({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  for (const segment of axisSegments(single)) {
    assert.equal(segment.length, 1);
  }
});

test("轴长上限可覆盖", () => {
  const segments = axisSegments(sampleBox, 1);
  for (const segment of segments) {
    assert.equal(segment.length, 1);
  }
});

test("尺寸文字在盒子上方一格的水平中心", () => {
  assert.deepEqual(labelPosition(sampleBox), { x: 105, y: 72, z: -15 });
});

test("clampNumber 夹住两端", () => {
  assert.equal(clampNumber(5, 1, 10), 5);
  assert.equal(clampNumber(0, 1, 10), 1);
  assert.equal(clampNumber(99, 1, 10), 10);
});
