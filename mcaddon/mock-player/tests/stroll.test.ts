// ─── rules/coords — 单次随机游走终点测试（纯逻辑） ────

import { test } from "node:test";
import assert from "node:assert/strict";

import { pickRandomStrollPoint, STROLL_DEFAULT_RADIUS } from "../scripts/rules/coords/Stroll";

test("随机游走终点：水平半径内随机（近点——不计算 16 格之外）", () => {
  const center = { x: 100, y: 64, z: 200 };
  // 固定随机源（每轴调用一次：dx 先、dz 后）：
  //   p1: dx=rng0=0 → -8；dz=rng1=0.5 → 0
  //   p2: dx=rng2=0.999 → +8；dz 回退 0.5 → 0
  const seq = [0, 0.5, 0.999];
  const rng = () => seq.shift() ?? 0.5;
  const p1 = pickRandomStrollPoint(center, STROLL_DEFAULT_RADIUS, rng);
  assert.equal(p1.x, 100 - 8 + 0.5, "dx=-8 → x 左移 8 格");
  assert.equal(p1.z, 200 + 0 + 0.5, "dz=0 → z 不变");
  const p2 = pickRandomStrollPoint(center, STROLL_DEFAULT_RADIUS, rng);
  assert.equal(p2.x, 100 + 8 + 0.5, "dx=+8 → x 右移 8 格");
  assert.equal(p2.z, 200 + 0 + 0.5, "dz=0 → z 不变");
  assert.equal(p2.y, 64, "y 取中心高度（地面由 mc 层修正）");
});

test("随机游走终点：任意随机值都在半径范围内", () => {
  const center = { x: 0, y: 64, z: 0 };
  for (let i = 0; i < 100; i++) {
    const p = pickRandomStrollPoint(center, 8);
    const dx = Math.floor(p.x) - 0;
    const dz = Math.floor(p.z) - 0;
    assert.ok(Math.abs(dx) <= 8 && Math.abs(dz) <= 8, `偏移在半径内: dx=${dx} dz=${dz}`);
  }
});

test("随机游走终点：自定义半径", () => {
  const center = { x: 50, y: 70, z: 50 };
  const p = pickRandomStrollPoint(center, 4, () => 0.999999); // 接近 1 → dx=+4（dz 同）
  assert.equal(p.x, 54.5);
  assert.equal(p.z, 54.5);
});

// ─── 官方陆地目标算法纯逻辑（wiki 随机游走节） ─────────

import { GRASS_BLOCK_BONUS, isStableBlockType, selectStrollTarget, strollWalkValue, type StrollCandidate } from "../scripts/rules/coords/Stroll";

test("selectStrollTarget：10 候选选行走目标值最大者（官方：取偏好最大为终点）", () => {
  const samples: (StrollCandidate | undefined)[] = [
    { point: { x: 1, y: 64, z: 0 }, walkValue: 0.3 },
    { point: { x: 2, y: 64, z: 0 }, walkValue: 0.9 },
    { point: { x: 3, y: 64, z: 0 }, walkValue: 0.1 },
    { point: { x: 4, y: 64, z: 0 }, walkValue: 0.5 },
  ];
  const best = selectStrollTarget(samples, 4);
  assert.equal(best?.x, 2, "选中行走目标值最大（0.9）的候选");
});

test("selectStrollTarget：无效候选跳过；全部无效 → undefined", () => {
  const samples: (StrollCandidate | undefined)[] = [
    { point: { x: 1, y: 64, z: 0 }, walkValue: 0.2 },
    undefined,
    { point: { x: 2, y: 64, z: 0 }, walkValue: 0.8 },
  ];
  assert.equal(selectStrollTarget(samples, 3)?.x, 2, "无效候选跳过");
  assert.equal(selectStrollTarget([undefined, undefined], 2), undefined, "全无效无终点");
});

test("strollWalkValue：官方位置行走目标值（主世界 i/(60-3i)-0.5，i=12 为零点，单调递增）", () => {
  assert.equal(strollWalkValue(0), -0.5);
  assert.equal(strollWalkValue(12), 0, "内部光照 12 为零点");
  assert.ok(strollWalkValue(15) > strollWalkValue(12), "越亮越优先");
  assert.ok(strollWalkValue(12) > strollWalkValue(0));
  assert.ok(Math.abs(strollWalkValue(15) - 0.5) < 1e-9, "i=15 → 0.5");
});

test("strollWalkValue：草方块偏好加成（官方动物语义 +10）", () => {
  // 草方块 = 位置值 + 10（压倒性偏好，对应动物对草方块 10）
  assert.ok(GRASS_BLOCK_BONUS === 10);
  assert.ok(strollWalkValue(0) + GRASS_BLOCK_BONUS > strollWalkValue(15), "草方块偏好压倒光照差异");
});

test("isStableBlockType：稳定方块判定（遮挡形状完整——台阶/楼梯/玻璃等不完整方块不行）", () => {
  assert.ok(isStableBlockType("minecraft:stone"), "石头是稳定方块");
  assert.ok(isStableBlockType("minecraft:grass_block"));
  assert.ok(!isStableBlockType("minecraft:oak_stairs"), "楼梯不稳定");
  assert.ok(!isStableBlockType("minecraft:oak_slab"), "台阶不稳定");
  assert.ok(!isStableBlockType("minecraft:glass"), "玻璃不稳定");
  assert.ok(!isStableBlockType("minecraft:oak_fence"), "栅栏不稳定");
  assert.ok(!isStableBlockType("minecraft:short_grass"), "草不稳定");
});
