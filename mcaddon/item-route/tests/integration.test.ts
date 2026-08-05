import { test } from "node:test";
import assert from "node:assert/strict";
import { ItemIndex } from "../scripts/core/index/ItemIndex";
import { Router } from "../scripts/core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { Scheduler } from "../scripts/core/scheduling/Scheduler";
import { MemoryIntervalScheduler } from "../scripts/core/scheduling/IntervalScheduler";
import { StatsService } from "../scripts/core/stats/StatsService";
import { OrganizeService } from "../scripts/core/services/OrganizeService";
import { Organizer } from "../scripts/core/organizing/Organizer";
import { WarehouseService } from "../scripts/core/services/WarehouseService";
import { MemberService } from "../scripts/core/services/MemberService";
import { InMemoryWarehouseStore, InMemoryStatsStore } from "../scripts/core/storage/Stores";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { MoveJournal } from "../scripts/core/routing/Move";
import { registerContainer } from "../scripts/core/model/ContainerRegistry";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";
import type { Warehouse } from "../scripts/core/model/Warehouse";

// ── 装配（对应 scripts/mc/main.ts 的 DI 组装，全部内存实现） ──────
function bootstrap() {
  const bus = new EventBus();
  const index = new ItemIndex();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    bus
  );
  const intervals = new MemoryIntervalScheduler();
  const proximity = { hasNearbyPlayer: () => true };
  const scheduler = new Scheduler(router, intervals, proximity, bus, 20, 40, { fallbackIndex: index });
  const stats = new StatsService(new InMemoryStatsStore(), bus);
  const organizer = new Organizer(new DefaultCandidateSorter());
  const organize = new OrganizeService(organizer, bus);
  const warehouses = new WarehouseService(new InMemoryWarehouseStore(), bus);
  const members = new MemberService();
  return { bus, index, router, scheduler, intervals, stats, organize, warehouses, members };
}

function makeWorld() {
  const app = bootstrap();
  const containers = new Map<string, InMemoryContainer>();
  const warehouse: Warehouse = {
    id: "w1",
    displayName: "测试仓",
    ownerId: "p1",
    members: [{ playerId: "p1", role: "owner" }],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } },
    settings: createDefaultSettings(),
    containers,
    inputs: new Map<string, InMemoryContainer>(),
  };
  const add = (c: InMemoryContainer) => {
    registerContainer(warehouse, c); // 单一写路径：containers + inputs 同步
    app.index.onContainerAdded(c);
    return c;
  };
  return { app, warehouse, add };
}

function totalItems(warehouse: Warehouse): number {
  let total = 0;
  for (const c of warehouse.containers.values()) {
    for (let i = 0; i < c.capacity; i++) {
      total += c.getItem(i)?.amount ?? 0;
    }
  }
  return total;
}

test("集成: 单物优先路由 + 事件 + 索引更新", () => {
  const { app, warehouse, add } = makeWorld();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const single = new InMemoryContainer("single1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  add(single);
  add(new InMemoryContainer("m1", "multi", 3));
  const events: string[] = [];
  app.bus.itemRouted.subscribe((e) => events.push(`${e.from}->${e.to}`));
  app.scheduler.registerWarehouse(warehouse);
  app.scheduler.tick();
  app.intervals.advance(8);
  assert.equal(input.getItem(0), undefined);
  assert.equal(single.getItem(0)?.amount, 15); // 5 + 10 堆叠
  assert.deepEqual(events, ["in->single1"]);
});

test("集成: 不吞物不复制（路由前后总量一致）", () => {
  const { app, warehouse, add } = makeWorld();
  const input = add(new InMemoryContainer("in", "input", 4));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 64, 64));
  input.setItem(1, new SimpleItemStack("minecraft:dirt", 32, 64));
  add(new InMemoryContainer("s1", "single", 3)).setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  add(new InMemoryContainer("m1", "multi", 3)).setItem(0, new SimpleItemStack("minecraft:dirt", 20, 64));
  add(new InMemoryContainer("x1", "misc", 3));
  const before = totalItems(warehouse);
  app.scheduler.registerWarehouse(warehouse);
  app.scheduler.tick();
  for (let i = 0; i < 3; i++) app.intervals.advance(8); // 处理 3 个 slot
  const after = totalItems(warehouse);
  assert.equal(before, after);
  assert.equal(input.getItem(0), undefined);
  assert.equal(input.getItem(1), undefined);
});

test("集成: 杂项兜底 + 统计预警", () => {
  const { app, warehouse, add } = makeWorld();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:wood", 10, 64));
  const misc = add(new InMemoryContainer("x1", "misc", 3));
  app.scheduler.registerWarehouse(warehouse);
  app.scheduler.tick();
  app.intervals.advance(8);
  assert.equal(input.getItem(0), undefined);
  assert.equal(misc.getItem(0)?.itemId, "minecraft:wood");
  const stats = app.stats.getWarehouseStats(warehouse);
  assert.equal(stats.totalItems, 10);
  const warnings = app.stats.evaluateWarnings(warehouse);
  assert.deepEqual(warnings, []); // 3 槽用 1 槽，无预警
});

test("集成: 整理器闭环（misc 归入 multi）", () => {
  const { app, warehouse, add } = makeWorld();
  const misc = add(new InMemoryContainer("x1", "misc", 4));
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  add(new InMemoryContainer("m1", "multi", 4)).setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  assert.equal(app.organize.organize(warehouse, new MoveJournal()).ok, true);
  assert.equal(misc.getItem(0), undefined);
  assert.equal(warehouse.containers.get("m1")?.getItem(0)?.amount, 15);
});

test("集成: 整理后对涉及容器逐一发 container-changed 事件（索引更新对外信号）", () => {
  const { app, warehouse, add } = makeWorld();
  const changed: string[] = [];
  app.bus.containerChanged.subscribe((e) => changed.push(e.containerId));
  const misc = add(new InMemoryContainer("x1", "misc", 4));
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  add(new InMemoryContainer("m1", "multi", 4)).setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  app.organize.organize(warehouse, new MoveJournal());
  assert.ok(changed.includes("x1")); // 源容器
  assert.ok(changed.includes("m1")); // 目标容器
  assert.deepEqual([...new Set(changed)].sort(), ["m1", "x1"]);
});

test("集成: 成员权限贯穿", () => {
  const { app, warehouse } = makeWorld();
  assert.equal(app.members.can(warehouse, "p1", "owner"), true);
  assert.equal(app.members.can(warehouse, "stranger", "visitor"), false);
});