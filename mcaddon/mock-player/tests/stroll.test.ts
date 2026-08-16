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
