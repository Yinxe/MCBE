// ─── BoxGeometry 单测:两角点 → 盒子尺寸/中心 ─────────────────────
//
// 这层是纯函数,不依赖 @minecraft/server,因此可以直接在 node 里跑。
// 重点验证三件事:
//   1. 边长 = |Δ| + 1(两个方块之间包含两端)
//   2. 小数坐标按所在方块取整(负坐标用 floor 而不是截断)
//   3. 两角点顺序无关

import assert from "node:assert/strict";
import { test } from "node:test";
import { boxFromCorners, exceedsMaxEdge, MAX_BOX_EDGE, toBlockPosition } from "../lib/scripts/BoxGeometry.js";

test("整数角点:边长 = |Δ| + 1", () => {
  const box = boxFromCorners({ x: 100, y: 64, z: -20 }, { x: 109, y: 71, z: -11 });
  assert.deepEqual(box.size, { x: 10, y: 8, z: 10 });
  assert.equal(box.volume, 800);
  assert.deepEqual(box.min, { x: 100, y: 64, z: -20 });
  assert.deepEqual(box.max, { x: 109, y: 71, z: -11 });
});

test("单格选区:边长都是 1", () => {
  const box = boxFromCorners({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  assert.deepEqual(box.size, { x: 1, y: 1, z: 1 });
  assert.equal(box.volume, 1);
});

test("中心落在 min + size/2,而不是 min + max / 2", () => {
  // 100..109 共 10 格,中心应为 105,不是 104.5
  const box = boxFromCorners({ x: 100, y: 64, z: -20 }, { x: 109, y: 71, z: -11 });
  assert.equal(box.center.x, 105);
  assert.equal(box.center.y, 68);
  assert.equal(box.center.z, -15);
});

test("角点顺序无关", () => {
  const a = { x: 100, y: 64, z: -20 };
  const b = { x: 109, y: 71, z: -11 };
  assert.deepEqual(boxFromCorners(a, b), boxFromCorners(b, a));
});

test("小数坐标按所在方块取整", () => {
  const box = boxFromCorners({ x: 100.7, y: 64.2, z: -20.1 }, { x: 100.7, y: 64.2, z: -20.1 });
  assert.deepEqual(box.min, { x: 100, y: 64, z: -21 });
  assert.deepEqual(box.size, { x: 1, y: 1, z: 1 });
});

test("负坐标用 floor 而不是截断", () => {
  // 截断会把 -20.9 算成 -20,而它实际属于 -21 号方块
  assert.deepEqual(toBlockPosition({ x: -20.9, y: -0.1, z: 0.9 }), { x: -21, y: -1, z: 0 });
});

test("跨零点的选区尺寸正确", () => {
  const box = boxFromCorners({ x: -2, y: -1, z: -3 }, { x: 2, y: 1, z: 3 });
  assert.deepEqual(box.size, { x: 5, y: 3, z: 7 });
});

test("单边超上限时判定为超限", () => {
  const ok = boxFromCorners({ x: 0, y: 0, z: 0 }, { x: MAX_BOX_EDGE - 1, y: 0, z: 0 });
  assert.equal(exceedsMaxEdge(ok), false);

  const tooWide = boxFromCorners({ x: 0, y: 0, z: 0 }, { x: MAX_BOX_EDGE, y: 0, z: 0 });
  assert.equal(exceedsMaxEdge(tooWide), true);
});
