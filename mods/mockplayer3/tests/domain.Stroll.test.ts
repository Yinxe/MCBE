// 游走 domain 纯逻辑单测：行走目标值 / 稳定块 / 选点决策 / 路线生成 / 转头角。
import test from "node:test";
import assert from "node:assert/strict";

import {
  STROLL_MAX_RAISE,
  STROLL_ROUTE_STEP_MAX,
  GRASS_BLOCK_BONUS,
  strollWalkValue,
  isStableBlockType,
  selectStrollTarget,
  pickDirectionalStrollPoint,
  generateStrollRoute,
  normalizeDeg,
  pickLookTargetYaw,
  randomBetween,
} from "../scripts/domain/Stroll";
import type { StrollCandidate } from "../scripts/domain/Stroll";

test("strollWalkValue：i=12 零点、越亮越大、边界 -0.5/0.5", () => {
  assert.equal(strollWalkValue(0), -0.5);
  assert.ok(Math.abs(strollWalkValue(12)) < 1e-9, "i=12 应为零点");
  assert.equal(strollWalkValue(15), 0.5);
  assert.ok(strollWalkValue(5) < strollWalkValue(10));
  assert.ok(strollWalkValue(10) < strollWalkValue(14));
});

test("isStableBlockType：台阶/楼梯/玻璃等不完整块拒绝，实心块放行", () => {
  assert.ok(!isStableBlockType("minecraft:oak_stairs"));
  assert.ok(!isStableBlockType("minecraft:stone_brick_slab"));
  assert.ok(!isStableBlockType("minecraft:glass"));
  assert.ok(!isStableBlockType("minecraft:oak_fence"));
  assert.ok(isStableBlockType("minecraft:stone"));
  assert.ok(isStableBlockType("minecraft:grass_block"));
  assert.ok(isStableBlockType("minecraft:dirt"));
});

test("selectStrollTarget：取行走目标值最大者、忽略无效、受 sampleCount 截断", () => {
  const mk = (x: number, walkValue: number): StrollCandidate => ({ point: { x, y: 0, z: 0 }, walkValue });
  const samples = [mk(1, 1), undefined, mk(2, 5), mk(3, 3)];
  assert.deepEqual(selectStrollTarget(samples), { x: 2, y: 0, z: 0 });
  // 截断到前 2 项（含一项无效）→ 只剩 walkValue=1 可选
  assert.deepEqual(selectStrollTarget(samples, 2), { x: 1, y: 0, z: 0 });
  assert.equal(selectStrollTarget([undefined, undefined]), undefined);
});

test("pickDirectionalStrollPoint：minDist 排除过近点（水平距离=minDist）", () => {
  const p = pickDirectionalStrollPoint({ x: 10.3, y: 64, z: -7.8 }, 0, 16, () => 0, 0.6, 60, 3);
  const dx = p.x - (Math.floor(10.3) + 0.5);
  const dz = p.z - (Math.floor(-7.8) + 0.5);
  assert.ok(Math.abs(Math.hypot(dx, dz) - 3) < 1e-9, "rng=0 → 距离恰为 minDist");
  assert.equal(p.y, 64, "y 保留起点（地面修正归 engine）");
});

test("generateStrollRoute：rng=0 → 点数=min（0 点=保持不动返回空表）", () => {
  const empty = generateStrollRoute({ x: 0, y: 64, z: 0 }, 0, { pointMin: 0, pointMax: 3, rng: () => 0 });
  assert.deepEqual(empty, []);
  const three = generateStrollRoute({ x: 0, y: 64, z: 0 }, 0, { pointMin: 3, pointMax: 3, rng: () => 0 });
  assert.equal(three.length, 3);
});

test("generateStrollRoute：所有路径点水平落在 radius 圆内、y 保持起点", () => {
  const center = { x: 100.5, y: 70, z: -50.5 };
  const route = generateStrollRoute(center, 42, { radius: 16, minDist: 3, pointMin: 0, pointMax: 3, rng: () => 0.5 });
  assert.ok(route.length >= 1);
  for (const p of route) {
    assert.equal(p.y, 70);
    assert.ok(Math.hypot(p.x - center.x, p.z - center.z) <= 16 + 1e-9, "点距 ≤ radius");
  }
});

test("generateStrollRoute：相邻点水平距离 ≤16（分居圆两侧相距 32 会被 too_far 中止）", () => {
  const center = { x: 0, y: 64, z: 0 };
  // rng 序列：2 点；P1 沿 +z 到圆沿（16 格），P2 向 -z 反方向迈步 12 格
  const seq = [0.99, 0.99, 0, 0.99, 0.99, 0.5, 0.99];
  let k = 0;
  const route = generateStrollRoute(center, 0, {
    radius: 16,
    minDist: 3,
    pointMin: 2,
    pointMax: 2,
    rng: () => seq[k++] ?? 0,
  });
  assert.equal(route.length, 2);
  const step = Math.hypot(route[1]!.x - route[0]!.x, route[1]!.z - route[0]!.z);
  assert.ok(step <= 16 + 1e-9, `相邻段距 ${step} 应不超过直达导航上限 16`);
});

test("generateStrollRoute：相邻点越圆沿时沿圆心射线收回圆沿、仍在圆内", () => {
  const center = { x: 0, y: 64, z: 0 };
  // rng 序列：2 点；P1 沿 +z 到圆沿（16 格），P2 顺延同方向再迈 12 格（候选 28 格）→ 收回圆沿
  const seq = [0.99, 0.99, 0, 0.99, 0.5, 0.5, 0.99];
  let k = 0;
  const route = generateStrollRoute(center, 0, {
    radius: 16,
    minDist: 3,
    pointMin: 2,
    pointMax: 2,
    rng: () => seq[k++] ?? 0,
  });
  assert.equal(route.length, 2);
  for (const p of route) {
    assert.ok(Math.hypot(p.x - center.x, p.z - center.z) <= 16 + 1e-9, "收回后仍在 radius 圆内");
  }
});

test("generateStrollRoute：radius<minDist 异常配置钳制到 minDist 并收回圆内", () => {
  const route = generateStrollRoute({ x: 0, y: 64, z: 0 }, 0, {
    radius: 2,
    minDist: 3,
    pointMin: 1,
    pointMax: 1,
    rng: () => 0,
  });
  assert.equal(route.length, 1);
  assert.ok(Math.hypot(route[0]!.x, route[0]!.z) <= 2 + 1e-9, "越圆点收回圆沿");
});

test("normalizeDeg：折回 (-180,180]（走最短弧）", () => {
  assert.equal(normalizeDeg(370), 10);
  assert.equal(normalizeDeg(-190), 170);
  assert.equal(normalizeDeg(181), -179);
  assert.equal(normalizeDeg(-180), 180);
});

test("pickLookTargetYaw：小幅概率内微调，否则全向随机", () => {
  // rng=0 → 命中小幅分支（0<0.7），第二次 rng=0 → base - spread
  assert.equal(
    pickLookTargetYaw(90, 0.7, 25, () => 0),
    65
  );
  // rng=0.9 → 0.9<0.7 假 → 大幅：0.9*360=324
  assert.equal(
    pickLookTargetYaw(90, 0.7, 25, () => 0.9),
    324
  );
});

test("randomBetween：闭区间端点（rng 注入）", () => {
  assert.equal(
    randomBetween(2, 5, () => 0),
    2
  );
  assert.equal(
    randomBetween(2, 5, () => 0.999),
    5
  );
  assert.equal(
    randomBetween(3, 3, () => 0.5),
    3
  );
});

test("常量锚定：STROLL_MAX_RAISE=8 / 草方块偏好=10 / 相邻步距上限=12", () => {
  assert.equal(STROLL_MAX_RAISE, 8);
  assert.equal(GRASS_BLOCK_BONUS, 10);
  assert.equal(STROLL_ROUTE_STEP_MAX, 12);
});
