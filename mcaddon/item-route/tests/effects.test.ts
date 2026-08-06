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
  // 区域 [0,1]（2 块），外表面 [0,2] → 线框 8 角点应在 {0,2}³
  const pts = edgePoints({ corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 1, y: 1, z: 1 } });
  const keys = new Set(pts.map((p) => `${p.x},${p.y},${p.z}`));
  for (const c of [0, 2]) {
    for (const y of [0, 2]) {
      for (const z of [0, 2]) {
        assert.ok(keys.has(`${c},${y},${z}`), `缺少外表面角点 ${c},${y},${z}`);
      }
    }
  }
});

test("BoundaryGeometry: 棱线框落到外表面（max+1）——4 条竖棱在角点、8 角点齐全（item 2.2）", () => {
  // 区域 [0,4]，块占 0..4，外表面 = 0..5；8 角点应在 {0,5}³（此前只有横向铺到 5、竖棱停在 4）
  const pts = edgePoints({ corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 4, y: 4, z: 4 } });
  const keys = new Set(pts.map((p) => `${p.x},${p.y},${p.z}`));
  for (const x of [0, 5]) {
    for (const y of [0, 5]) {
      for (const z of [0, 5]) {
        assert.ok(keys.has(`${x},${y},${z}`), `缺少外表面角点 ${x},${y},${z}`);
      }
    }
  }
  // 竖棱固定坐标随区域外扩：存在 x=5,z=5 的一整条竖棱（y 走满 min..max+1）
  for (const c of ["5,5", "0,5", "5,0", "0,0"]) {
    const [cx, cz] = c.split(",").map(Number);
    assert.ok(
      keys.has(`${cx},0,${cz}`) && keys.has(`${cx},5,${cz}`),
      `竖棱 ${c} 应从底面到顶面`
    );
  }
});
