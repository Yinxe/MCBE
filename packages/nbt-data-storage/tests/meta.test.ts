import test from "node:test";
import assert from "node:assert/strict";
import { allocateSlotId, createLevelPools, createRegionMeta, releaseSlotId, usedSlots } from "../src/core/meta";

test("allocateSlotId：依次推进水印（O(1) 增长）", () => {
  const meta = createRegionMeta();
  const pools = createLevelPools(4);
  assert.equal(allocateSlotId(meta, pools, 10), 0);
  assert.equal(allocateSlotId(meta, pools, 10), 1);
  assert.equal(allocateSlotId(meta, pools, 10), 2);
  assert.equal(meta.nextFree, 3);
  assert.equal(usedSlots(meta), 3);
});

test("allocateSlotId：容量满返回 null", () => {
  const meta = createRegionMeta();
  const pools = createLevelPools(4);
  for (let i = 0; i < 3; i++) assert.equal(allocateSlotId(meta, pools, 3), i);
  assert.equal(allocateSlotId(meta, pools, 3), null);
});

test("releaseSlotId：空洞优先复用，水印不受影响", () => {
  const meta = createRegionMeta();
  const pools = createLevelPools(4);
  allocateSlotId(meta, pools, 100); // 0
  allocateSlotId(meta, pools, 100); // 1
  allocateSlotId(meta, pools, 100); // 2 → nextFree 3
  releaseSlotId(meta, pools, 1);
  assert.equal(usedSlots(meta), 2);
  assert.equal(meta.holeCount, 1);
  assert.deepEqual(meta.holeLevels, [0]);
  assert.equal(allocateSlotId(meta, pools, 100), 1); // 复用空洞
  assert.equal(meta.holeCount, 0);
  assert.deepEqual(meta.holeLevels, []);
  assert.equal(allocateSlotId(meta, pools, 100), 3); // 无洞后推进水印
  assert.equal(meta.nextFree, 4);
});

test("releaseSlotId：超过水印/负数的槽位被忽略（防重复回收越界）", () => {
  const meta = createRegionMeta();
  const pools = createLevelPools(4);
  allocateSlotId(meta, pools, 10); // nextFree → 1
  releaseSlotId(meta, pools, 5); // 5 >= nextFree → 忽略
  releaseSlotId(meta, pools, -1); // 忽略
  releaseSlotId(meta, pools, Number.NaN); // 忽略
  assert.equal(meta.holeCount, 0);
  assert.equal(meta.holeLevels.length, 0);
});

test("usedSlots：水印 − 空洞总数", () => {
  const meta = createRegionMeta();
  const pools = createLevelPools(4);
  for (let i = 0; i < 5; i++) allocateSlotId(meta, pools, 10);
  releaseSlotId(meta, pools, 0);
  releaseSlotId(meta, pools, 2);
  assert.equal(usedSlots(meta), 3);
  assert.equal(meta.holeCount, 2);
});
