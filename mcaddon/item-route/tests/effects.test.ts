import { test } from "node:test";
import assert from "node:assert/strict";
import { SORT_PARTICLE, DEPOSIT_PARTICLE } from "../scripts/mc/effects/SortEffects";
import { STEP, edgePoints } from "../scripts/core/model/BoundaryGeometry";

test("SortEffects: 粒子 identifier 常量", () => {
  assert.equal(SORT_PARTICLE, "itemroute:sort");
  assert.equal(DEPOSIT_PARTICLE, "itemroute:deposit");
});

test("BoundaryGeometry: STEP 常量", () => {
  assert.equal(STEP, 0.6);
});

test("BoundaryGeometry: edgePoints 生成 12 棱线框以平铺立方体", () => {
  const pts = edgePoints({ corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 0, y: 0, z: 0 } });
  assert.ok(pts.length > 0);
  // 体积 = 1（退化单点）至少覆盖自身
  assert.ok(pts.length >= 1);
  for (const p of pts) {
    assert.equal(p.x, 0);
    assert.equal(p.y, 0);
    assert.equal(p.z, 0);
  }
});

test("BoundaryGeometry: edgePoints 覆盖 1×1×1 立方体 12 条棱 8 角点", () => {
  const pts = edgePoints({ corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 1, y: 1, z: 1 } });
  const keys = new Set(pts.map((p) => `${p.x},${p.y},${p.z}`));
  for (const corner of ["0,0,0", "1,0,0", "0,1,0", "0,0,1", "1,1,0", "1,0,1", "0,1,1", "1,1,1"]) {
    assert.ok(keys.has(corner), `缺少角点 ${corner}`);
  }
});