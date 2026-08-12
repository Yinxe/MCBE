// ── 批量读取分组纯逻辑测试（core/batch.ts） ────────────────
// groupSlotIdsByBarrel：同桶合并 / 跨桶分离 / 越界跳过 / 输入索引保留 / 跨层。

import { test } from "node:test";
import assert from "node:assert/strict";

import { barrelKey, groupSlotIdsByBarrel } from "../src/core/batch";
import { SLOTS_PER_LEVEL, type RegionLayout } from "../src/core/layout";

/** 微型布局：1 层（仅测试分组几何，不涉及容量） */
const LAYOUT: RegionLayout = {
  chunkX: 0,
  chunkZ: 0,
  baseY: 0,
  maxLevels: 1,
  slotPerBarrel: 27,
  test: false,
};

test("同桶格合并为一组（一次容器读取）", () => {
  const groups = groupSlotIdsByBarrel([0, 1, 5], LAYOUT);
  assert.equal(groups.size, 1);
  const entries = [...groups.values()][0]!;
  assert.deepEqual(
    entries.map((e) => ({ slotInBarrel: e.slotInBarrel, inputIndex: e.inputIndex, slotId: e.slotId })),
    [
      { slotInBarrel: 0, inputIndex: 0, slotId: 0 },
      { slotInBarrel: 1, inputIndex: 1, slotId: 1 },
      { slotInBarrel: 5, inputIndex: 2, slotId: 5 },
    ]
  );
  assert.equal(entries[0]!.pos.x, 0);
  assert.equal(entries[0]!.pos.y, 0);
  assert.equal(entries[0]!.pos.z, 0);
});

test("跨桶格分离为多组（每桶一次读取）", () => {
  const groups = groupSlotIdsByBarrel([0, 26, 27, 53], LAYOUT);
  assert.equal(groups.size, 2); // 桶0（0,26）与桶1（27,53）
  const keys = [...groups.keys()].sort();
  assert.equal(keys[0], "0,0,0"); // 桶 0：x0,y0,z0
  assert.equal(keys[1], "1,0,0"); // 桶 1：x=0+1%16, z=0+floor(1/16)
});

test("越界 slotId 跳过（输出位保持 undefined）", () => {
  const groups = groupSlotIdsByBarrel([0, -1, 999999], LAYOUT);
  assert.equal(groups.size, 1);
  const entries = [...groups.values()][0]!;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.inputIndex, 0); // 越界位无条目
});

test("输入乱序：组内保留输入下标（输出对齐）", () => {
  const groups = groupSlotIdsByBarrel([27, 0, 5], LAYOUT);
  // 桶0 组：0（input 1）、5（input 2）；桶1 组：27（input 0）
  const barrel0 = groups.get("0,0,0")!;
  const barrel1 = groups.get("1,0,0")!;
  assert.deepEqual(barrel0.map((e) => e.inputIndex), [1, 2]);
  assert.deepEqual(barrel1.map((e) => e.inputIndex), [0]);
});

test("重复 slotId 各自保留（重复读，不合并去重）", () => {
  const groups = groupSlotIdsByBarrel([3, 3], LAYOUT);
  const entries = [...groups.values()][0]!;
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.slotInBarrel), [3, 3]);
});

test("跨层：第二层桶 y 上移（baseY + level）", () => {
  const layout: RegionLayout = { ...LAYOUT, maxLevels: 2 };
  // slotId 6912 = 第 1 层桶 0 格 0（SLOTS_PER_LEVEL = 27×256）
  const groups = groupSlotIdsByBarrel([0, SLOTS_PER_LEVEL], layout);
  assert.equal(groups.size, 2);
  const level1 = groups.get("0,1,0")!; // y = baseY(0) + level(1)
  assert.ok(level1, "第 1 层桶 0 应存在（y=1）");
  assert.equal(level1[0]!.slotInBarrel, 0);
});

test("barrelKey 唯一标识木桶", () => {
  assert.equal(barrelKey({ x: 1, y: 2, z: 3, slotInBarrel: 0 }), "1,2,3");
  // 不同格同桶 → 相同 key
  assert.equal(
    barrelKey({ x: 5, y: 0, z: 7, slotInBarrel: 0 }),
    barrelKey({ x: 5, y: 0, z: 7, slotInBarrel: 26 })
  );
});
