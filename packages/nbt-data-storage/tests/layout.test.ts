import test from "node:test";
import assert from "node:assert/strict";
import {
  BARREL_SLOTS,
  BARRELS_PER_LEVEL,
  MAX_LEVELS,
  SLOTS_PER_LEVEL,
  barrelIndexOf,
  capacityOf,
  chunkFromAnchor,
  chunkFromBlock,
  isValidSlotId,
  levelOf,
  materializedBarrelsFor,
  slotIdToPosition,
  totalBarrelsOf,
  validateLayout,
  type RegionLayout,
} from "../src/core/layout";

const DEFAULT: RegionLayout = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 };

test("capacityOf：单层 = 256 桶 × 27 槽；默认 4 层 = 27648", () => {
  assert.equal(capacityOf({ ...DEFAULT, maxLevels: 1 }), SLOTS_PER_LEVEL);
  assert.equal(capacityOf(DEFAULT), 4 * SLOTS_PER_LEVEL);
});

test("MAX_LEVELS：固定 64 层，容量 = 442368 槽，顶层落在第 63 层", () => {
  assert.equal(MAX_LEVELS, 64);
  const layout: RegionLayout = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: MAX_LEVELS };
  assert.equal(capacityOf(layout), 64 * SLOTS_PER_LEVEL);
  assert.equal(validateLayout(layout), null);
  const last = capacityOf(layout) - 1; // 442367
  const pos = slotIdToPosition(last, layout);
  assert.ok(pos);
  assert.equal(pos.y, 120 + 63);
  assert.equal(pos.x, 15);
  assert.equal(pos.z, 15);
  assert.equal(pos.slotInBarrel, BARREL_SLOTS - 1);
});

test("totalBarrelsOf：满容量桶总数 = 层数 × 256", () => {
  assert.equal(totalBarrelsOf({ ...DEFAULT, maxLevels: 1 }), 256);
  assert.equal(totalBarrelsOf(DEFAULT), 4 * 256);
  assert.equal(totalBarrelsOf({ ...DEFAULT, maxLevels: MAX_LEVELS }), 64 * 256);
});

test("slotIdToPosition：0 号槽位于区块原点 (0, baseY, 0)", () => {
  assert.deepEqual(slotIdToPosition(0, DEFAULT), { x: 0, y: 120, z: 0, slotInBarrel: 0 });
});

test("slotIdToPosition：木桶内槽位先填满（27 个一格）", () => {
  assert.equal(slotIdToPosition(26, DEFAULT)?.slotInBarrel, 26);
  assert.deepEqual(slotIdToPosition(27, DEFAULT), { x: 1, y: 120, z: 0, slotInBarrel: 0 });
});

test("slotIdToPosition：跨层推进 Y（每层 6912 槽）", () => {
  assert.deepEqual(slotIdToPosition(SLOTS_PER_LEVEL, DEFAULT), { x: 0, y: 121, z: 0, slotInBarrel: 0 });
  assert.equal(levelOf(SLOTS_PER_LEVEL), 1);
});

test("slotIdToPosition：X 先走满 16 再推进 Z（区块内 0..255 桶）", () => {
  // 27*16=432 → 第 16 桶 → x=16%16=0, 世界 z=chunkZ*16 + floor(16/16)=1
  assert.deepEqual(slotIdToPosition(27 * 16, DEFAULT), { x: 0, y: 120, z: 1, slotInBarrel: 0 });
  // 第 255 桶 → x=15, z=15
  const last = capacityOf(DEFAULT) - 1;
  assert.deepEqual(slotIdToPosition(last, DEFAULT), { x: 15, y: 123, z: 15, slotInBarrel: BARREL_SLOTS - 1 });
});

test("slotIdToPosition：负数区块坐标正确偏移", () => {
  const layout: RegionLayout = { chunkX: -1, chunkZ: 2, baseY: 100, maxLevels: 2 };
  assert.deepEqual(slotIdToPosition(0, layout), { x: -16, y: 100, z: 32, slotInBarrel: 0 });
  assert.deepEqual(slotIdToPosition(27, layout), { x: -15, y: 100, z: 32, slotInBarrel: 0 });
});

test("slotIdToPosition：越界/非法输入返回 null", () => {
  assert.equal(slotIdToPosition(-1, DEFAULT), null);
  assert.equal(slotIdToPosition(capacityOf(DEFAULT), DEFAULT), null);
  assert.equal(slotIdToPosition(1.5, DEFAULT), null);
});

test("isValidSlotId：范围 + 整数校验", () => {
  assert.equal(isValidSlotId(-1, DEFAULT), false);
  assert.equal(isValidSlotId(0, DEFAULT), true);
  assert.equal(isValidSlotId(capacityOf(DEFAULT) - 1, DEFAULT), true);
  assert.equal(isValidSlotId(capacityOf(DEFAULT), DEFAULT), false);
  assert.equal(isValidSlotId(1.5, DEFAULT), false);
  assert.equal(isValidSlotId(Number.NaN, DEFAULT), false);
});

test("barrelIndexOf / materializedBarrelsFor：按 27 槽一桶折算", () => {
  assert.equal(barrelIndexOf(26), 0);
  assert.equal(barrelIndexOf(27), 1);
  assert.equal(materializedBarrelsFor(0), 1);
  assert.equal(materializedBarrelsFor(27), 2);
  // 第一层末尾：第 256 桶
  assert.equal(materializedBarrelsFor(SLOTS_PER_LEVEL - 1), BARRELS_PER_LEVEL);
});

test("validateLayout：合法返回 null", () => {
  assert.equal(validateLayout(DEFAULT), null);
  assert.equal(validateLayout({ ...DEFAULT, baseY: 0, maxLevels: 1 }), null);
});

test("validateLayout：非法布局返回中文错误", () => {
  assert.ok(validateLayout({ ...DEFAULT, baseY: -65 })); // 低于世界最低层 -64
  assert.equal(validateLayout({ ...DEFAULT, baseY: -64 }), null); // 世界最低层合法
  assert.ok(validateLayout({ ...DEFAULT, maxLevels: 0 }));
  assert.ok(validateLayout({ ...DEFAULT, maxLevels: 65 })); // 超过 64 层上限
  assert.ok(validateLayout({ ...DEFAULT, maxLevels: 1.5 }));
  assert.ok(validateLayout({ ...DEFAULT, chunkX: 1.5 }));
  // 顶部 Y = baseY + maxLevels - 1 ≤ 320 合法；= 321 越界
  assert.equal(validateLayout({ ...DEFAULT, baseY: 319, maxLevels: 2 }), null); // 顶部 320
  assert.ok(validateLayout({ ...DEFAULT, baseY: 320, maxLevels: 2 })); // 顶部 321
  assert.equal(validateLayout({ ...DEFAULT, baseY: 320, maxLevels: 1 }), null); // 顶部 320
});

test("chunkFromBlock：四象限 + 区块边界点精确归块（区块 c 覆盖块 [16c, 16c+15]）", () => {
  // [块坐标, 期望区块]：取各象限的"块内中段 / 区块首块(16c) / 区块末块(16c+15) / 越界首块(16(c+1))"
  const cases: Array<[number, number]> = [
    // 第 1 象限（x ≥ 0）：区块 0/1/2
    [0, 0],
    [15, 0],
    [16, 1],
    [31, 1],
    [32, 2],
    [255, 15],
    [256, 16],
    // 第 2 象限（x < 0）：区块 -1/-2/-3
    [-1, -1],
    [-16, -1],
    [-17, -2],
    [-32, -2],
    [-33, -3],
    // 第 3/4 象限 与 一般值
    [100, 6],
    [-100, -7],
    [7, 0],
    [-7, -1],
  ];
  for (const [coord, expect] of cases) {
    assert.equal(chunkFromBlock(coord), expect, `块坐标 ${coord} 应归区块 ${expect}`);
  }
});

test("chunkFromAnchor：块内任意坐标（含小数）归同一区块，越过 16 倍数进入下一区块", () => {
  // 区块 -1 覆盖块 [-16,-1]：任取块内（含小数）坐标都归 -1
  assert.deepEqual(chunkFromAnchor(-16, -1), { cx: -1, cz: -1 });
  assert.deepEqual(chunkFromAnchor(-0.5, -0.5), { cx: -1, cz: -1 });
  assert.deepEqual(chunkFromAnchor(-15.99, -1.5), { cx: -1, cz: -1 });
  // 边界：恰好踩在 16 倍数上 → 下一区块首块
  assert.deepEqual(chunkFromAnchor(16, 0), { cx: 1, cz: 0 });
  assert.deepEqual(chunkFromAnchor(0, -17), { cx: 0, cz: -2 });
  // 同区块不同锚点 → 同一存储地址（共享前提）
  assert.deepEqual(chunkFromAnchor(2, 3), chunkFromAnchor(15, 14));
  assert.deepEqual(chunkFromAnchor(-14, -2), chunkFromAnchor(-1, -16));
  // 不同区块锚点 → 不同存储地址
  assert.notDeepEqual(chunkFromAnchor(0, 0), chunkFromAnchor(16, 0));
});
