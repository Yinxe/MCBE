import { test } from "node:test";
import assert from "node:assert/strict";
import { locationKey } from "../scripts/core/model/types";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";
import { deriveBinding } from "../scripts/core/model/DeriveBinding";

test("locationKey: 生成稳定坐标键", () => {
  assert.equal(locationKey({ x: 1, y: 2, z: 3 }), "1,2,3");
  assert.equal(locationKey({ x: -5, y: 0, z: 10 }), "-5,0,10");
});

test("SimpleItemStack: 基础属性与克隆", () => {
  const s = new SimpleItemStack("minecraft:stone", 64, 64);
  assert.equal(s.itemId, "minecraft:stone");
  assert.equal(s.amount, 64);
  const clone = s.clone();
  assert.notEqual(clone, s);
  assert.equal(clone.amount, 64);
});

test("SimpleItemStack: 可堆叠判定", () => {
  const a = new SimpleItemStack("minecraft:stone", 10, 64);
  const b = new SimpleItemStack("minecraft:stone", 20, 64);
  const c = new SimpleItemStack("minecraft:dirt", 10, 64);
  assert.equal(a.isStackableWith(b), true);
  assert.equal(a.isStackableWith(c), false);
});

test("SimpleItemStack: 深度相等含数量", () => {
  const a = new SimpleItemStack("minecraft:stone", 10, 64);
  const b = new SimpleItemStack("minecraft:stone", 10, 64);
  const c = new SimpleItemStack("minecraft:stone", 11, 64);
  assert.equal(a.equals(b), true);
  assert.equal(a.equals(c), false);
});

test("InMemoryContainer: 基础读写与容量", () => {
  const c = new InMemoryContainer("c1", "multi", 3);
  assert.equal(c.capacity, 3);
  assert.equal(c.emptySlotsCount, 3);
  assert.equal(c.usedSlots, 0);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  assert.equal(c.usedSlots, 1);
  assert.equal(c.emptySlotsCount, 2);
  assert.equal(c.getItem(0)?.itemId, "minecraft:stone");
});

test("InMemoryContainer: addItem 返回剩余", () => {
  const c = new InMemoryContainer("c1", "multi", 2);
  const stone = new SimpleItemStack("minecraft:stone", 64, 64);
  const remaining = c.addItem(stone);
  assert.equal(remaining, undefined); // 全部放入
  assert.equal(c.getItem(0)?.amount, 64);
  const more = new SimpleItemStack("minecraft:stone", 64, 64);
  const rem2 = c.addItem(more); // 第 2 槽放 64，剩余 0 → undefined
  assert.equal(rem2, undefined);
  const full = new SimpleItemStack("minecraft:dirt", 64, 64);
  const rem3 = c.addItem(full); // 已满 2 槽 → 全部剩余
  assert.equal(rem3?.amount, 64);
});

test("createDefaultSettings: 默认值", () => {
  const s = createDefaultSettings();
  assert.equal(s.routingEnabled, true);
  assert.equal(s.sortingEnabled, true);
  assert.equal(s.processingSpeed, 8);
  assert.equal(s.warningThreshold, 0.9);
  assert.equal(s.autoSortThreshold, 0.4); // v1 混乱度阈值（0-1）
});

test("deriveBinding: 由首个非空 slot 推导", () => {
  const c = new InMemoryContainer("c1", "single", 3);
  assert.equal(deriveBinding(c), undefined); // 空箱
  c.setItem(1, new SimpleItemStack("minecraft:stone", 10, 64)); // 第 2 槽先有物
  assert.equal(deriveBinding(c), "minecraft:stone");
  c.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64)); // 首槽被替换
  assert.equal(deriveBinding(c), "minecraft:dirt");
  c.setItem(0, undefined);
  assert.equal(deriveBinding(c), "minecraft:stone");
});

test("Container 便捷搜索: firstNoEmptyItem/lastNoEmptyItem/firstEmptySlot/contains/find/findLast", () => {
  const c = new InMemoryContainer("c1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  c.setItem(2, new SimpleItemStack("minecraft:dirt", 3, 64));
  assert.equal(c.firstNoEmptyItem(), 0);
  assert.equal(c.lastNoEmptyItem(), 2);
  assert.equal(c.firstEmptySlot(), 1);
  assert.equal(c.contains(new SimpleItemStack("minecraft:stone", 1, 64)), true);
  assert.equal(c.contains(new SimpleItemStack("minecraft:wood", 1, 64)), false);
  assert.equal(c.find(new SimpleItemStack("minecraft:dirt", 1, 64)), 2);
  assert.equal(c.findLast(new SimpleItemStack("minecraft:dirt", 1, 64)), 2);
  // 末个非空槽跟随后槽变化
  c.setItem(3, new SimpleItemStack("minecraft:stone", 1, 64));
  assert.equal(c.lastNoEmptyItem(), 3);
  // 两个同型堆 → findLast 返回更大槽
  c.setItem(2, new SimpleItemStack("minecraft:dirt", 3, 64));
  c.setItem(3, new SimpleItemStack("minecraft:dirt", 1, 64));
  assert.equal(c.findLast(new SimpleItemStack("minecraft:dirt", 1, 64)), 3);
  // 清空后无首/末非空槽
  c.setItem(0, undefined);
  assert.equal(c.firstNoEmptyItem(), 2);
  for (let i = 0; i < c.capacity; i++) c.setItem(i, undefined);
  assert.equal(c.firstNoEmptyItem(), undefined);
  assert.equal(c.lastNoEmptyItem(), undefined);
});
