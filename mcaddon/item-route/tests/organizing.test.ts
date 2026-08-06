import { test } from "node:test";
import assert from "node:assert/strict";
import { Organizer } from "../scripts/core/organizing/Organizer";
import { scanContainer } from "../scripts/core/model/ContainerScan";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

test("Organizer: chaosScore v1 模型（顺序逆序对 70% + 未满堆叠 30%）", () => {
  const organizer = new Organizer();
  const empty = new InMemoryContainer("e", "multi", 4);
  assert.equal(organizer.chaosScore(empty), 0);
  // 同型已满堆 ×2：无逆序、无未满堆叠 → 纯净
  const clean = new InMemoryContainer("c", "multi", 4);
  clean.setItem(0, new SimpleItemStack("minecraft:stone", 64, 64));
  clean.setItem(1, new SimpleItemStack("minecraft:stone", 64, 64));
  assert.equal(organizer.chaosScore(clean), 0);
  // 同型未满堆 ×2：可合并 → 堆叠分 0.3
  const loose = new InMemoryContainer("l", "multi", 4);
  loose.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  loose.setItem(1, new SimpleItemStack("minecraft:stone", 1, 64));
  assert.equal(organizer.chaosScore(loose), 0.3);
  // 三类型错序（stone,dirt,wood）：1/2 相邻逆序 ×0.7 = 0.35
  const mixed = new InMemoryContainer("m", "multi", 4);
  mixed.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  mixed.setItem(1, new SimpleItemStack("minecraft:dirt", 1, 64));
  mixed.setItem(2, new SimpleItemStack("minecraft:wood", 1, 64));
  assert.equal(organizer.chaosScore(mixed), 0.35);
});

test("Organizer: shouldAutoSort v1 阈值（0-1）", () => {
  const organizer = new Organizer();
  const mixed = new InMemoryContainer("m", "multi", 4);
  mixed.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  mixed.setItem(1, new SimpleItemStack("minecraft:dirt", 1, 64));
  // total = 0.7（stone>dirt 相邻逆序占满）
  assert.equal(organizer.shouldAutoSort(mixed, 0.8), false); // 阈值高于 0.7 → 不整
  assert.equal(organizer.shouldAutoSort(mixed, 0.4), true); // 阈值低于 0.7 → 整
  // 单堆/空容器 → total 0，永不因自动整理触发
  const clean = new InMemoryContainer("c", "multi", 4);
  clean.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  assert.equal(organizer.shouldAutoSort(clean, 0), false); // 非空槽 ≤1 → total 0
});

test("Organizer: shouldAutoSortFromScan 与 messinessFromScan 吃同一趟扫描", () => {
  const organizer = new Organizer();
  const mixed = new InMemoryContainer("m", "multi", 4);
  mixed.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  mixed.setItem(1, new SimpleItemStack("minecraft:dirt", 1, 64));
  const scan = scanContainer(mixed);
  assert.equal(organizer.shouldAutoSortFromScan(scan, 0.4), true); // total 0.7 > 0.4
  assert.equal(organizer.messinessFromScan(scan).total, 0.7);
});
