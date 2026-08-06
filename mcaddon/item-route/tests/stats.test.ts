import { test } from "node:test";
import assert from "node:assert/strict";
import { StatsService } from "../scripts/core/stats/StatsService";
import { InMemoryStatsStore } from "../scripts/core/storage/Stores";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { scanContainer } from "../scripts/core/model/ContainerScan";
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
    inputs: new Map<string, InMemoryContainer>(),
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

test("StatsService: 90% 阈值触发警告预警（带冷却）", () => {
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
  assert.deepEqual(svc.evaluateWarnings(warehouse), ["warning"]);
  assert.deepEqual(warnings, ["warning"]);
  // 冷却内不再触发
  assert.deepEqual(svc.evaluateWarnings(warehouse), []);
  svc.tick(); // 冷却递减（100 tick 需 100 次）
  for (let i = 0; i < 100; i++) svc.tick();
  assert.deepEqual(svc.evaluateWarnings(warehouse), ["warning"]);
  assert.equal(warnings.length, 2);
});

test("StatsService: 容器级增量预警（只查目标容器，O(1)）", () => {
  const { warehouse, containers } = makeWarehouse();
  const over = new InMemoryContainer("over", "multi", 10);
  for (let i = 0; i < 9; i++) over.setItem(i, new SimpleItemStack(`minecraft:o${i}`, 1, 64)); // 90%
  const under = new InMemoryContainer("under", "multi", 10);
  under.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64)); // 10%
  containers.set("over", over);
  containers.set("under", under);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  // 路由到超阈值目标 → 报 warning（容器级）
  assert.deepEqual(svc.evaluateWarnings(warehouse, "over"), ["warning"]);
  // 路由到未超阈值目标 → 不报（即使同仓另有超阈值容器，增量只查目标）
  assert.deepEqual(svc.evaluateWarnings(warehouse, "under"), []);
});

test("StatsService: 满仓预警（全仓非 input 全满才报 full）", () => {
  const { warehouse, containers } = makeWarehouse();
  const a = new InMemoryContainer("a", "multi", 2);
  a.setItem(0, new SimpleItemStack("minecraft:stone", 64, 64));
  a.setItem(1, new SimpleItemStack("minecraft:stone", 64, 64)); // 满
  const b = new InMemoryContainer("b", "misc", 2);
  b.setItem(0, new SimpleItemStack("minecraft:dirt", 64, 64));
  b.setItem(1, new SimpleItemStack("minecraft:dirt", 64, 64)); // 满
  containers.set("a", a);
  containers.set("b", b);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  const levels = svc.evaluateWarnings(warehouse);
  assert.ok(levels.includes("full")); // 满仓
  assert.ok(levels.includes("warning")); // 满容器也超阈值
  // 有容器超阈值但仓库未满 → 只 warning 不 full（c：90% 未满；d：空）
  const c = new InMemoryContainer("c", "multi", 10);
  for (let i = 0; i < 9; i++) c.setItem(i, new SimpleItemStack(`minecraft:wood:${i}`, 1, 64));
  const d = new InMemoryContainer("d", "multi", 10); // 空
  const wh2 = makeWarehouse();
  wh2.warehouse.containers.set("c", c);
  wh2.warehouse.containers.set("d", d);
  const svc2 = new StatsService(new InMemoryStatsStore(), new EventBus());
  assert.deepEqual(svc2.evaluateWarnings(wh2.warehouse), ["warning"]); // 无 full
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

test("StatsService: updateFromScan 用外部扫描维护缓存（免二次扫描）", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  c.setItem(2, new SimpleItemStack("minecraft:stone", 3, 64)); // 同型两堆
  c.setItem(3, new SimpleItemStack("minecraft:dirt", 5, 64));
  containers.set("m1", c);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  // 用混乱度检查的同一趟扫描喂给统计缓存（含 byType 明细 + 容量指标）
  const scan = scanContainer(c);
  const s = svc.updateFromScan(c, scan, warehouse.settings.warningThreshold);
  assert.equal(s.usedSlots, 3);
  assert.equal(s.totalItems, 18);
  assert.equal(s.uniqueTypes, 2);
  assert.equal(s.byType["minecraft:stone"], 13);
  // 缓存已维护：后续 getContainerStats 直接命中，不再扫描
  assert.equal(svc.getContainerStats(warehouse, c).byType["minecraft:stone"], 13);
});

test("StatsService: getWarehouseStats 查看时写穿透每容器统计键", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  containers.set("m1", c);
  const store = new InMemoryStatsStore();
  const svc = new StatsService(store, new EventBus());
  svc.getWarehouseStats(warehouse); // 查看汇总 → 落盘
  const saved = store.loadContainer("m1"); // 每容器一条键
  assert.ok(saved !== undefined);
  assert.equal(saved.totalItems, 10);
  assert.equal(saved.usedSlots, 1);
});

test("StatsService: updateFromScan 事件驱动立即写穿单容器（最小单位）", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  containers.set("m1", c);
  const store = new InMemoryStatsStore();
  const svc = new StatsService(store, new EventBus());
  // 路由扫描事件驱动：updateFromScan 立即写穿该容器自己的键（无脏集/无 flush）
  svc.updateFromScan(c, scanContainer(c), warehouse.settings.warningThreshold);
  const saved = store.loadContainer("m1");
  assert.ok(saved !== undefined);
  assert.equal(saved.usedSlots, 1);
  // 改另一个容器 → m1 键不受影响（单容器最小单位）
  const cOther = new InMemoryContainer("m2", "multi", 4);
  cOther.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64));
  svc.updateFromScan(cOther, scanContainer(cOther), warehouse.settings.warningThreshold);
  assert.equal(store.loadContainer("m1")?.usedSlots, 1);
  assert.equal(store.loadContainer("m2")?.usedSlots, 1);
});

test("StatsService: 无 warm —— 新实例冷读按实时内容重算 + 写穿（最小加载）", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  containers.set("m1", c);
  const store = new InMemoryStatsStore();
  const svc = new StatsService(store, new EventBus());
  svc.getContainerStats(warehouse, c); // 计算 + 写穿
  // 模拟重载：新 StatsService（同 store），内容已变 → 冷读实时重算（不 warm 旧值）
  const c2 = new InMemoryContainer("m1", "multi", 4);
  c2.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  c2.setItem(1, new SimpleItemStack("minecraft:dirt", 5, 64));
  const svc2 = new StatsService(store, new EventBus());
  assert.equal(svc2.getContainerStats(warehouse, c2).usedSlots, 2); // 冷读实时重算，不加载旧持久化
  assert.equal(store.loadContainer("m1")?.usedSlots, 2); // 写穿最新
});

test("StatsService: isWarning 实时按当前 warningThreshold 判定（改阈值无需 invalidate）", () => {
  const { warehouse, containers } = makeWarehouse();
  const c = new InMemoryContainer("m1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64)); // 1/4 槽 = 25%
  containers.set("m1", c);
  const svc = new StatsService(new InMemoryStatsStore(), new EventBus());
  warehouse.settings.warningThreshold = 0.9;
  assert.equal(svc.getContainerStats(warehouse, c).isWarning, false);
  warehouse.settings.warningThreshold = 0.1; // 只改阈值，不 invalidate
  assert.equal(svc.getContainerStats(warehouse, c).isWarning, true); // 缓存命中但实时重算
});