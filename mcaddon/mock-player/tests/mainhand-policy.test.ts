// ─── core/items — 主手选择策略 ────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { canClearMainhand, slotLabel } from "../scripts/items/MainhandPolicy";

test("canClearMainhand：存在非主手空槽可清空", () => {
  const items = ["剑", null, "石头"];
  assert.equal(canClearMainhand(items, 0), true);
});

test("canClearMainhand：仅主手槽为空不可清空（物品无处可去）", () => {
  const items = [null, "a", "b"];
  assert.equal(canClearMainhand(items, 0), false);
});

test("canClearMainhand：全满不可清空", () => {
  assert.equal(canClearMainhand(["a", "b", "c"], 0), false);
});

test("canClearMainhand：主手之外的任何空槽均可", () => {
  const items = ["剑", "石头", null, "木头"];
  assert.equal(canClearMainhand(items, 0), true);
  assert.equal(canClearMainhand(items, 3), true);
});

test("slotLabel：热栏 1-9 / 背包 10+", () => {
  assert.equal(slotLabel(0), "热栏1");
  assert.equal(slotLabel(8), "热栏9");
  assert.equal(slotLabel(9), "背包10");
  assert.equal(slotLabel(35), "背包36");
});