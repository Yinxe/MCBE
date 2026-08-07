import { test } from "node:test";
import assert from "node:assert/strict";
import { Organizer } from "../scripts/core/organizing/Organizer";
import { pickInventoryPhase } from "../scripts/core/organizing/InventoryPhase";
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

test("Organizer: 空槽参与顺序计算——空槽在物品中间视为错位（理想位置在末尾）", () => {
  const organizer = new Organizer();
  // [stone, 空, dirt]：空槽放在物品中间 → 空>dirt 逆序 1/2 × 0.7 = 0.35
  const hole = new InMemoryContainer("h", "multi", 4);
  hole.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  hole.setItem(2, new SimpleItemStack("minecraft:dirt", 5, 64));
  assert.equal(organizer.chaosScore(hole), 0.35);
  // [空, dirt, wood]：空槽在首位（理想应在末尾）→ 空>dirt 逆序 1/2 × 0.7 = 0.35
  const leading = new InMemoryContainer("l", "multi", 4);
  leading.setItem(1, new SimpleItemStack("minecraft:dirt", 5, 64));
  leading.setItem(2, new SimpleItemStack("minecraft:wood", 5, 64));
  assert.equal(organizer.chaosScore(leading), 0.35);
  // [dirt, wood, 空]：尾随空槽是理想位置 → 不额外计逆序 → 0（干净）
  const trailing = new InMemoryContainer("t", "multi", 4);
  trailing.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64));
  trailing.setItem(1, new SimpleItemStack("minecraft:wood", 5, 64));
  assert.equal(organizer.chaosScore(trailing), 0);
  // 对比：空槽前置/中置 的混乱度 > 尾随空槽（验证"空位理想顺序在末尾"）
  assert.ok(organizer.chaosScore(leading) > organizer.chaosScore(trailing));
});

test("Organizer: 单物品但空槽前置 → 混乱度非 0（item 6：空应排最后）", () => {
  const organizer = new Organizer();
  // [空, 钻石]：理想顺序是钻石在首、空在尾 → 空>钻石 逆序 1/1 × 0.7 = 0.7
  const frontEmpty = new InMemoryContainer("fe", "multi", 4);
  frontEmpty.setItem(1, new SimpleItemStack("minecraft:diamond", 12, 64));
  assert.equal(organizer.chaosScore(frontEmpty), 0.7);
  // [钻石, 空]：物品在首、空在尾（理想）→ 0
  const trailing = new InMemoryContainer("tr", "multi", 4);
  trailing.setItem(0, new SimpleItemStack("minecraft:diamond", 12, 64));
  assert.equal(organizer.chaosScore(trailing), 0);
  // 空容器 → 0
  assert.equal(organizer.chaosScore(new InMemoryContainer("e", "multi", 4)), 0);
});

test("InventoryPhase: 2 阶段整理决策——主栏优先，归零转快捷栏，两区齐才完全干净", () => {
  // 主栏乱 → 只整理主栏（快捷栏待下次）
  assert.deepEqual(pickInventoryPhase(0.3, 0), { region: "main", hotbarPending: false });
  assert.deepEqual(pickInventoryPhase(0.3, 0.5), { region: "main", hotbarPending: true });
  // 主栏归 0 → 本次整理快捷栏
  assert.deepEqual(pickInventoryPhase(0, 0.5), { region: "hotbar" });
  // 两区都归 0 → 完全整齐
  assert.deepEqual(pickInventoryPhase(0, 0), { region: "clean" });
});
