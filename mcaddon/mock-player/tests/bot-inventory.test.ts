// ─── core/bot — 背包纯逻辑（查找/计数/空位/边界） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  countItemTotal,
  findEmptySlot,
  findFirstItemByPriority,
  findItemSlots,
  isValidSlot,
  type SlotView,
} from "../scripts/core/bot/Inventory";

/** 测试工厂：条目数组 → 槽位视图（null = 空槽） */
function inv(entries: Array<[string, number] | null>): SlotView[] {
  return entries.map((e) => (e ? { typeId: e[0], amount: e[1] } : undefined));
}

test("findItemSlots：找指定物品所有槽位", () => {
  const items = inv([
    ["minecraft:iron_ingot", 5],
    null,
    ["minecraft:diamond", 1],
    ["minecraft:iron_ingot", 3],
  ]);
  assert.deepEqual(findItemSlots(items, "minecraft:iron_ingot"), [0, 3]);
  assert.deepEqual(findItemSlots(items, "minecraft:diamond"), [2]);
  assert.deepEqual(findItemSlots(items, "minecraft:emerald"), []);
});

test("findFirstItemByPriority：按优先级顺序取第一处（宝库钥匙语义）", () => {
  const items = inv([
    ["minecraft:stone", 1],
    ["minecraft:ominous_trial_key", 1],
    ["minecraft:trial_key", 2],
  ]);
  // 普通宝库：普通钥匙优先、不详钥匙兜底
  assert.equal(findFirstItemByPriority(items, ["minecraft:trial_key", "minecraft:ominous_trial_key"]), 2);
  // 不详宝库：仅不详钥匙
  assert.equal(findFirstItemByPriority(items, ["minecraft:ominous_trial_key"]), 1);
  assert.equal(findFirstItemByPriority(items, ["minecraft:emerald"]), undefined);
});

test("countItemTotal：跨槽合计（数量累加）", () => {
  const items = inv([
    ["minecraft:iron_ingot", 5],
    null,
    ["minecraft:iron_ingot", 3],
    ["minecraft:diamond", 1],
  ]);
  assert.equal(countItemTotal(items, "minecraft:iron_ingot"), 8);
  assert.equal(countItemTotal(items, "minecraft:diamond"), 1);
  assert.equal(countItemTotal(items, "minecraft:emerald"), 0);
});

test("findEmptySlot：第一个空槽", () => {
  const items = inv([
    ["minecraft:stone", 1],
    null,
    null,
  ]);
  assert.equal(findEmptySlot(items), 1);
  assert.equal(findEmptySlot(inv([["minecraft:stone", 1]])), undefined); // 无空槽
  assert.equal(findEmptySlot(inv([])), undefined); // 空容器
});

test("isValidSlot：边界校验", () => {
  const items = inv([
    ["minecraft:stone", 1],
    null,
  ]);
  assert.equal(isValidSlot(items, 0), true);
  assert.equal(isValidSlot(items, 1), true);
  assert.equal(isValidSlot(items, 2), false); // 越上界
  assert.equal(isValidSlot(items, -1), false); // 越下界
});
