import test from "node:test";
import assert from "node:assert/strict";
import { allocateSlotId, createRegionMeta, releaseSlotId, usedSlots } from "../src/core/meta";

test("allocateSlotId：依次推进水印（O(1) 增长）", () => {
  const meta = createRegionMeta();
  assert.equal(allocateSlotId(meta, 10), 0);
  assert.equal(allocateSlotId(meta, 10), 1);
  assert.equal(allocateSlotId(meta, 10), 2);
  assert.equal(meta.nextFree, 3);
  assert.equal(usedSlots(meta), 3);
});

test("allocateSlotId：容量满返回 null", () => {
  const meta = createRegionMeta();
  for (let i = 0; i < 3; i++) assert.equal(allocateSlotId(meta, 3), i);
  assert.equal(allocateSlotId(meta, 3), null);
});

test("releaseSlotId：空洞优先复用，水印不受影响", () => {
  const meta = createRegionMeta();
  allocateSlotId(meta, 100); // 0
  allocateSlotId(meta, 100); // 1
  allocateSlotId(meta, 100); // 2 → nextFree 3
  releaseSlotId(meta, 1);
  assert.equal(usedSlots(meta), 2);
  assert.equal(allocateSlotId(meta, 100), 1); // 复用空洞
  assert.equal(allocateSlotId(meta, 100), 3); // 无洞后推进水印
  assert.equal(meta.nextFree, 4);
});

test("releaseSlotId：超过水印/负数的槽位被忽略（防重复回收越界）", () => {
  const meta = createRegionMeta();
  allocateSlotId(meta, 10); // nextFree → 1
  releaseSlotId(meta, 5); // 5 >= nextFree → 忽略
  releaseSlotId(meta, -1); // 忽略
  releaseSlotId(meta, Number.NaN); // 忽略
  assert.equal(meta.freePool.length, 0);
});

test("usedSlots：水印 − 空洞数", () => {
  const meta = createRegionMeta();
  for (let i = 0; i < 5; i++) allocateSlotId(meta, 10);
  releaseSlotId(meta, 0);
  releaseSlotId(meta, 2);
  assert.equal(usedSlots(meta), 3);
  assert.equal(meta.freePool.length, 2);
});
