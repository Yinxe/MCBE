// ─── core/coords — 长途寻路分段（纯几何切段） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildLongNavigateWaypoints, decideWaypointY, LONG_NAV_SEGMENT_DISTANCE } from "../scripts/rules/coords/Waypoints";

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

test("长途分段：距离 ≤12 格 → 单点直达（= 终点）", () => {
  const pts = buildLongNavigateWaypoints({ x: 0, y: 64, z: 0 }, { x: 10, y: 64, z: 5 });
  assert.deepEqual(pts, [{ x: 10, y: 64, z: 5 }]);
});

test("长途分段：恰好 12 格 → 单点直达", () => {
  const pts = buildLongNavigateWaypoints({ x: 0, y: 64, z: 0 }, { x: 12, y: 64, z: 0 });
  assert.deepEqual(pts, [{ x: 12, y: 64, z: 0 }]);
});

test("长途分段：50 格 → 5 段，每段水平 ≤12 且末段=终点", () => {
  const start = { x: 0, y: 64, z: 0 };
  const target = { x: 50, y: 64, z: 0 };
  const pts = buildLongNavigateWaypoints(start, target);
  assert.equal(pts.length, Math.ceil(50 / LONG_NAV_SEGMENT_DISTANCE)); // ceil(50/12) = 5
  assert.ok(maxSegmentDistance(pts, start) <= LONG_NAV_SEGMENT_DISTANCE + 1e-9, "每段水平距离应 ≤12");
  assert.deepEqual(pts[pts.length - 1], target);
});

test("长途分段：斜线 48 格（水平 60）→ 每段水平 ≤12", () => {
  const start = { x: 0, y: 70, z: 0 };
  const target = { x: 36, y: 70, z: 48 }; // 水平 = 60
  const pts = buildLongNavigateWaypoints(start, target);
  assert.equal(pts.length, Math.ceil(60 / LONG_NAV_SEGMENT_DISTANCE));
  assert.ok(maxSegmentDistance(pts, start) <= LONG_NAV_SEGMENT_DISTANCE + 1e-9);
  assert.deepEqual(pts[pts.length - 1], target);
});

test("长途分段：垂直随进度线性插值（y 从 64 渐变到 80）", () => {
  const start = { x: 0, y: 64, z: 0 };
  const target = { x: 48, y: 80, z: 0 };
  const pts = buildLongNavigateWaypoints(start, target);
  assert.equal(pts.length, Math.ceil(48 / LONG_NAV_SEGMENT_DISTANCE)); // ceil(48/12) = 4
  // t = 1/4, 2/4, 3/4, 1 → y = 64 + 16t = 68, 72, 76, 80
  assert.ok(Math.abs(pts[0]!.y - 68) < 1e-9);
  assert.ok(Math.abs(pts[1]!.y - 72) < 1e-9);
  assert.ok(Math.abs(pts[2]!.y - 76) < 1e-9);
  assert.equal(pts[3]!.y, 80);
});

test("长途分段：自定义单段上限（10 格）", () => {
  const start = { x: 0, y: 64, z: 0 };
  const target = { x: 35, y: 64, z: 0 };
  const pts = buildLongNavigateWaypoints(start, target, 10);
  assert.equal(pts.length, 4); // ceil(35/10) = 4
  assert.ok(maxSegmentDistance(pts, start) <= 10 + 1e-9);
  assert.deepEqual(pts[pts.length - 1], target);
});

// ─── 段点 y 地面化决策（decideWaypointY，用户规格） ──

test("段点 y 地面化：目标 y 处是空气 → 保持（引擎寻路到其下方地面）", () => {
  const r = decideWaypointY((y) => ({ isAir: y >= 60, isLiquid: false }), 64.5, 24);
  assert.deepEqual(r, { kind: "keep" });
});

test("段点 y 地面化：埋在实心方块 → 上移到第一个空气方块", () => {
  // 64 以下实心，65 起空气
  const r = decideWaypointY((y) => ({ isAir: y >= 65, isLiquid: false }), 63.7, 24);
  assert.deepEqual(r, { kind: "raise", y: 65 });
});

test("段点 y 地面化：上一格即空气 → 上移 1 格", () => {
  const r = decideWaypointY((y) => ({ isAir: y >= 61, isLiquid: false }), 60, 24);
  assert.deepEqual(r, { kind: "raise", y: 61 });
});

test("段点 y 地面化：目标 y 处是水（液体）→ 不调整", () => {
  const r = decideWaypointY(() => ({ isAir: false, isLiquid: true }), 62, 24);
  assert.deepEqual(r, { kind: "keep" });
});

test("段点 y 地面化：区块未加载（query 返回 undefined）→ 降级保留插值 y", () => {
  const r = decideWaypointY(() => undefined, 70, 24);
  assert.deepEqual(r, { kind: "keep" });
});

test("段点 y 地面化：实心但向上扫描遇区块边界 → 降级保留", () => {
  // 60 实心，61 起不可查询
  const r = decideWaypointY((y) => (y >= 61 ? undefined : { isAir: false, isLiquid: false }), 60, 24);
  assert.deepEqual(r, { kind: "keep" });
});

test("段点 y 地面化：超上调上限未找到空气 → 降级保留", () => {
  const r = decideWaypointY(() => ({ isAir: false, isLiquid: false }), 60, 2);
  assert.deepEqual(r, { kind: "keep" });
});
