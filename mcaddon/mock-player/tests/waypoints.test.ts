// ─── core/coords — 长途寻路分段（纯几何切段） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildLongNavigateWaypoints, LONG_NAV_SEGMENT_DISTANCE } from "../scripts/rules/coords/Waypoints";

/** 相邻段水平距离（验证每段 ≤ 上限） */
function maxSegmentDistance(points: Array<{ x: number; y: number; z: number }>, start: { x: number; y: number; z: number }): number {
  let max = 0;
  let prev = start;
  for (const p of points) {
    max = Math.max(max, Math.hypot(p.x - prev.x, p.z - prev.z));
    prev = p;
  }
  return max;
}

test("长途分段：距离 ≤16 格 → 单点直达（= 终点）", () => {
  const pts = buildLongNavigateWaypoints({ x: 0, y: 64, z: 0 }, { x: 10, y: 64, z: 5 });
  assert.deepEqual(pts, [{ x: 10, y: 64, z: 5 }]);
});

test("长途分段：恰好 16 格 → 单点直达", () => {
  const pts = buildLongNavigateWaypoints({ x: 0, y: 64, z: 0 }, { x: 16, y: 64, z: 0 });
  assert.deepEqual(pts, [{ x: 16, y: 64, z: 0 }]);
});

test("长途分段：50 格 → 4 段，每段水平 ≤16 且末段=终点", () => {
  const start = { x: 0, y: 64, z: 0 };
  const target = { x: 50, y: 64, z: 0 };
  const pts = buildLongNavigateWaypoints(start, target);
  assert.equal(pts.length, 4); // ceil(50/16) = 4
  assert.ok(maxSegmentDistance(pts, start) <= LONG_NAV_SEGMENT_DISTANCE + 1e-9, "每段水平距离应 ≤16");
  assert.deepEqual(pts[pts.length - 1], target);
});

test("长途分段：斜线 48 格（水平 60）→ 每段水平 ≤16", () => {
  const start = { x: 0, y: 70, z: 0 };
  const target = { x: 36, y: 70, z: 48 }; // 水平 = 60
  const pts = buildLongNavigateWaypoints(start, target);
  assert.equal(pts.length, Math.ceil(60 / 16));
  assert.ok(maxSegmentDistance(pts, start) <= LONG_NAV_SEGMENT_DISTANCE + 1e-9);
  assert.deepEqual(pts[pts.length - 1], target);
});

test("长途分段：垂直随进度线性插值（y 从 64 渐变到 80）", () => {
  const start = { x: 0, y: 64, z: 0 };
  const target = { x: 48, y: 80, z: 0 };
  const pts = buildLongNavigateWaypoints(start, target);
  assert.equal(pts.length, 3); // ceil(48/16) = 3
  // t = 1/3, 2/3, 1 → y = 64 + 16t = 69.33..., 74.66..., 80
  assert.ok(Math.abs(pts[0]!.y - (64 + 16 / 3)) < 1e-9);
  assert.ok(Math.abs(pts[1]!.y - (64 + 32 / 3)) < 1e-9);
  assert.equal(pts[2]!.y, 80);
});

test("长途分段：自定义单段上限（10 格）", () => {
  const start = { x: 0, y: 64, z: 0 };
  const target = { x: 35, y: 64, z: 0 };
  const pts = buildLongNavigateWaypoints(start, target, 10);
  assert.equal(pts.length, 4); // ceil(35/10) = 4
  assert.ok(maxSegmentDistance(pts, start) <= 10 + 1e-9);
  assert.deepEqual(pts[pts.length - 1], target);
});
