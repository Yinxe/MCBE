import { test } from "node:test";
import assert from "node:assert/strict";
import { StatsService } from "../scripts/core/stats/StatsService";
import { InMemoryStatsStore } from "../scripts/core/storage/Stores";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

function makeWarehouse() {
  const containers = new Map<string, InMemoryContainer>();
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers,
  };
  return { warehouse, containers };
}

test("StatsService: 容器统计（槽位/物品/类型）", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  c.setItem(1, new SimpleItemStack("minecraft:stone", 20, 64));
  c.setItem(2, new SimpleItemStack("minecraft:dirt", 5, 64));
  containers.set("m1", c);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  const stats = svc.getContainerStats(warehouse, c);
  assert.equal(stats.totalSlots, 4);
  assert.equal(stats.usedSlots, 3);
  assert.equal(stats.totalItems, 35);
  assert.equal(stats.uniqueTypes, 2);
  assert.equal(stats.byType["minecraft:stone"], 30);
  assert.equal(stats.isWarning, false);
});

test("StatsService: 90% 阈值触发黄色预警（带冷却）", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 10);
  for (let i = 0; i < 9; i++) {
    c.setItem(i, new SimpleItemStack(`minecraft:item${i}`, 1, 64));
  }
  containers.set("m1", c);
  const bus = new EventBus();
  const warnings: string[] = [];
  bus.warning.subscribe((e) => warnings.push(e.level));
  const svc = new StatsService(new InMemoryStatsStore(), bus);
  assert.deepEqual(svc.evaluateWarnings(warehouse), ["yellow"]);
  assert.deepEqual(warnings, ["yellow"]);
  // 冷却内不再触发
  assert.deepEqual(svc.evaluateWarnings(warehouse), []);
  svc.tick(); // 冷却递减（100 tick 需 100 次）
  for (let i = 0; i < 100; i++) svc.tick();
  assert.deepEqual(svc.evaluateWarnings(warehouse), ["yellow"]);
  assert.equal(warnings.length, 2);
});

test("StatsService: 仓库统计汇总", () => {
  const { warehouse, containers } = makeWarehouse();
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  containers.set("in", input);
  containers.set("m1", multi);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  const stats = svc.getWarehouseStats(warehouse);
  assert.equal(stats.containerCount, 2);
  assert.equal(stats.totalSlots, 7);
  assert.equal(stats.usedSlots, 2);
  assert.equal(stats.totalItems, 15);
  assert.equal(stats.uniqueTypes, 1);
  assert.equal(stats.byType["minecraft:stone"], 15);
  assert.equal(stats.byItem["minecraft:stone"]!.stacks, 2);
  assert.deepEqual(stats.byItem["minecraft:stone"]!.containerIds.sort(), ["in", "m1"]);
});

test("StatsService: invalidate 清缓存", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  containers.set("m1", c);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  const before = svc.getContainerStats(warehouse, c);
  c.setItem(1, new SimpleItemStack("minecraft:dirt", 3, 64)); // 直接改容器
  const stale = svc.getContainerStats(warehouse, c); // 缓存未失效
  assert.equal(stale.usedSlots, 1);
  svc.invalidate(c.id);
  const fresh = svc.getContainerStats(warehouse, c);
  assert.equal(fresh.usedSlots, 2);
  assert.notEqual(before, undefined);
});