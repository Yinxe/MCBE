import { test } from "node:test";
import assert from "node:assert/strict";
import { SORT_PARTICLE, DEPOSIT_PARTICLE } from "../scripts/mc/effects/ParticleIds";
import { STEP, edgePoints } from "../scripts/core/model/BoundaryGeometry";

test("SortEffects: 粒子 identifier 常量", () => {
  assert.equal(SORT_PARTICLE, "itemroute:sort");
  assert.equal(DEPOSIT_PARTICLE, "itemroute:deposit");
});

test("BoundaryGeometry: STEP 常量", () => {
  assert.equal(STEP, 0.6);
});

test("BoundaryGeometry: edgePoints 生成边界点（坐标落在块外表面范围）", () => {
  const pts = edgePoints({ corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 0, y: 0, z: 0 } });
  assert.ok(pts.length > 0);
  // 退化单块：边界坐标应落在 [0,1]（块外表面，item 2.2 补 x+1/y+1/z+1；含内角点 0,0,0）
  const keys = new Set(pts.map((p) => `${p.x},${p.y},${p.z}`));
  assert.ok(keys.has("0,0,0"), "应含内角点 0,0,0");
  for (const p of pts) {
    assert.ok(p.x === 0 || p.x === 1, `x 应为边界 0/1，实际 ${p.x}`);
    assert.ok(p.y === 0 || p.y === 1, `y 应为边界 0/1，实际 ${p.y}`);
    assert.ok(p.z === 0 || p.z === 1, `z 应为边界 0/1，实际 ${p.z}`);
  }
});

test("BoundaryGeometry: edgePoints 覆盖 1×1×1 立方体 12 条棱 8 角点", () => {
  const pts = edgePoints({ corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 1, y: 1, z: 1 } });
  const keys = new Set(pts.map((p) => `${p.x},${p.y},${p.z}`));
  for (const corner of ["0,0,0", "1,0,0", "0,1,0", "0,0,1", "1,1,0", "1,0,1", "0,1,1", "1,1,1"]) {
    assert.ok(keys.has(corner), `缺少角点 ${corner}`);
  }
});
