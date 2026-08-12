// ─── core/items — 三叉戟规则 ──────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { TRIDENT_ID, isTrident, scanTridentSlots } from "../scripts/core/items/TridentRules";
import { makeItem } from "./helpers/factories";

test("常量与识别", () => {
  assert.equal(TRIDENT_ID, "minecraft:trident");
  assert.ok(isTrident("minecraft:trident"));
  assert.ok(!isTrident("minecraft:iron_sword"));
});

test("scanTridentSlots：主手三叉戟计入 isMainhand", () => {
  const items = [makeItem("minecraft:trident"), null, null];
  const slots = scanTridentSlots(items, 0, true);
  assert.deepEqual(slots, [{ slotIndex: 0, isMainhand: true }]);
});

test("scanTridentSlots：背包三叉戟 + 主手不同时重复计入", () => {
  const items = [
    makeItem("minecraft:trident"), // 主手
    makeItem("minecraft:trident"),
    makeItem("minecraft:diamond"),
  ];
  const slots = scanTridentSlots(items, 0, true);
  assert.deepEqual(slots, [
    { slotIndex: 0, isMainhand: true },
    { slotIndex: 1, isMainhand: false },
  ]);
});

test("scanTridentSlots：主手不是三叉戟时全槽扫描", () => {
  const items = [makeItem("minecraft:diamond_sword"), makeItem("minecraft:trident"), null];
  const slots = scanTridentSlots(items, 0, false);
  assert.deepEqual(slots, [{ slotIndex: 1, isMainhand: false }]);
});

test("scanTridentSlots：无三叉戟返回空数组", () => {
  const items = [makeItem("minecraft:diamond"), makeItem("minecraft:diamond")];
  assert.deepEqual(scanTridentSlots(items, 0, false), []);
});