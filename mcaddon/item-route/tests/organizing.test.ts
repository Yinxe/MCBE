import { test } from "node:test";
import assert from "node:assert/strict";
import { Organizer } from "../scripts/core/organizing/Organizer";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { MoveJournal } from "../scripts/core/routing/Move";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

function makeWarehouse(containers: InMemoryContainer[]) {
  return {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map(containers.map((c) => [c.id, c])),
  };
}

test("Organizer: chaosScore 混合类型越多越乱", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const empty = new InMemoryContainer("e", "multi", 4);
  assert.equal(organizer.chaosScore(empty), 0);
  const single = new InMemoryContainer("s", "multi", 4);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  single.setItem(1, new SimpleItemStack("minecraft:stone", 2, 64));
  assert.equal(organizer.chaosScore(single), 0); // 单类型 = 纯净
  const mixed = new InMemoryContainer("m", "multi", 4);
  mixed.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  mixed.setItem(1, new SimpleItemStack("minecraft:dirt", 1, 64));
  mixed.setItem(2, new SimpleItemStack("minecraft:wood", 1, 64));
  assert.equal(organizer.chaosScore(mixed), 2); // 3 类型 - 1
});

test("Organizer: analyze 杂项物品归入同类型多物容器", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const misc = new InMemoryContainer("x", "misc", 4);
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const wh = makeWarehouse([misc, multi]);
  const plan = organizer.analyze(wh);
  assert.equal(plan.actions.length, 1);
  assert.deepEqual(plan.actions[0], { from: "x", fromSlot: 0, to: "m1" });
  assert.equal(plan.chaosBefore >= plan.chaosAfter, true);
});

test("Organizer: analyze 多物容器间合并（单向，避免互逆）", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const a = new InMemoryContainer("a", "multi", 4);
  a.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const b = new InMemoryContainer("b", "multi", 4);
  b.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const wh = makeWarehouse([a, b]);
  const plan = organizer.analyze(wh);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0]?.from, "a");
  assert.equal(plan.actions[0]?.to, "b");
});

test("Organizer: apply 执行移动，失败回滚源不变", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const misc = new InMemoryContainer("x", "misc", 4);
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const wh = makeWarehouse([misc, multi]);
  const plan = organizer.analyze(wh);
  const journal = new MoveJournal();
  assert.equal(organizer.apply(wh, plan, journal), true);
  assert.equal(misc.getItem(0), undefined);
  assert.equal(multi.getItem(0)?.amount, 15);
  // 失败场景：目标容器从仓库移除（模拟方块被破坏）
  const misc2 = new InMemoryContainer("x2", "misc", 4);
  misc2.setItem(0, new SimpleItemStack("minecraft:dirt", 10, 64));
  const wh2 = makeWarehouse([misc2]);
  const plan2 = organizer.analyze(wh2); // 无目标 → actions 空
  assert.equal(plan2.actions.length, 0);
  assert.equal(organizer.apply(wh2, plan2, new MoveJournal()), true); // 无操作视为成功
});

test("Organizer: apply 执行中目标失效 → 整体回滚", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const misc = new InMemoryContainer("x", "misc", 4);
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  misc.setItem(1, new SimpleItemStack("minecraft:dirt", 10, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const wh = makeWarehouse([misc, multi]);
  const plan = organizer.analyze(wh);
  // 篡改计划：指向不存在的目标 → apply 失败
  const badPlan = { ...plan, actions: [{ from: "x", fromSlot: 0, to: "ghost" }] };
  const journal = new MoveJournal();
  assert.equal(organizer.apply(wh, badPlan, journal), false);
  // 回滚后源未变
  assert.equal(misc.getItem(0)?.amount, 10);
});

test("Organizer: shouldAutoSort 阈值", () => {
  const organizer = new Organizer(new DefaultCandidateSorter());
  const mixed = new InMemoryContainer("m", "multi", 4);
  mixed.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  mixed.setItem(1, new SimpleItemStack("minecraft:dirt", 1, 64));
  assert.equal(organizer.shouldAutoSort(mixed, 3), false); // chaos 1 < 3
  mixed.setItem(2, new SimpleItemStack("minecraft:wood", 1, 64));
  mixed.setItem(3, new SimpleItemStack("minecraft:iron", 1, 64));
  assert.equal(organizer.shouldAutoSort(mixed, 3), false); // chaos 3 不 > 阈值 3（需第 5 种类型才触发）
});