import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryIntervalScheduler } from "../scripts/core/scheduling/IntervalScheduler";

test("MemoryIntervalScheduler: 按 tick 间隔触发，stop 后停止", () => {
  const sched = new MemoryIntervalScheduler();
  let count = 0;
  const handle = sched.createInterval(() => count++, 4);
  sched.advance(3);
  assert.equal(count, 0);
  sched.advance(1); // 累计 4 tick
  assert.equal(count, 1);
  handle.stop();
  sched.advance(8);
  assert.equal(count, 1);
});

test("MemoryIntervalScheduler: 多 interval 独立", () => {
  const sched = new MemoryIntervalScheduler();
  let a = 0;
  let b = 0;
  sched.createInterval(() => a++, 2);
  sched.createInterval(() => b++, 5);
  sched.advance(10);
  assert.equal(a, 5);
  assert.equal(b, 2);
});

// ── Task 17: Scheduler ─────────────────────────────────
import { Scheduler } from "../scripts/core/scheduling/Scheduler";
import { Router } from "../scripts/core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { ItemIndex } from "../scripts/core/index/ItemIndex";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

class StubProximity {
  private nearby = new Set<string>();
  setNearby(id: string, v: boolean): void {
    if (v) this.nearby.add(id);
    else this.nearby.delete(id);
  }
  hasNearbyPlayer(warehouseId: string): boolean {
    return this.nearby.has(warehouseId);
  }
}

function makeWorld() {
  const intervals = new MemoryIntervalScheduler();
  const proximity = new StubProximity();
  const index = new ItemIndex();
  const bus = new EventBus();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    index,
    bus
  );
  const scheduler = new Scheduler(router, intervals, proximity, bus);
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
  return { intervals, proximity, index, router, scheduler, warehouse, containers };
}

test("Scheduler: 生命周期 inactive → active → inactive", () => {
  const w = makeWorld();
  w.scheduler.registerWarehouse(w.warehouse);
  assert.equal(w.scheduler.getLifecycle("w1"), "inactive");
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getLifecycle("w1"), "active");
  w.proximity.setNearby("w1", false);
  w.scheduler.tick();
  assert.equal(w.scheduler.getLifecycle("w1"), "deactivating");
  for (let i = 0; i < 41; i++) w.scheduler.tick();
  assert.equal(w.scheduler.getLifecycle("w1"), "inactive");
});

test("Scheduler: 激活后 interval 按 processingSpeed 处理单槽", () => {
  const w = makeWorld();
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  // 目标多物容器需已含 stone 才成为索引候选（设计 §4.2：候选来自索引 + misc 兜底）
  const target = new InMemoryContainer("m1", "multi", 3);
  target.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  w.containers.set("in", input);
  w.containers.set("m1", target);
  w.index.onContainerAdded(input);
  w.index.onContainerAdded(target);
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick(); // → active（创建 8 tick interval）
  w.intervals.advance(8); // 处理 1 槽
  assert.equal(input.getItem(0), undefined);
  assert.equal(target.getItem(0)?.itemId, "minecraft:stone");
  assert.equal(target.getItem(0)?.amount, 15); // 5 + 10 堆叠
});

test("Scheduler: 速度被全局限制 clamp", () => {
  const w = makeWorld();
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.scheduler.setProcessingSpeed("w1", 40); // 超全局限制 20
  assert.equal(w.scheduler.getIntervalTicks("w1"), 20);
});

test("Scheduler: unregister 无泄漏（interval 停止）", () => {
  const w = makeWorld();
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getIntervalTicks("w1") !== undefined, true);
  w.scheduler.unregisterWarehouse("w1");
  assert.equal(w.scheduler.getIntervalTicks("w1"), undefined);
  let fired = false;
  w.intervals.createInterval(() => (fired = true), 1);
  w.intervals.advance(1);
  assert.equal(fired, true); // 调度器本身仍可用（无全局污染）
});

test("Scheduler: 全局开关暂停/恢复", () => {
  const w = makeWorld();
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getIntervalTicks("w1") !== undefined, true);
  w.scheduler.setGlobalEnabled(false);
  assert.equal(w.scheduler.getIntervalTicks("w1"), undefined);
  w.scheduler.setGlobalEnabled(true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getIntervalTicks("w1") !== undefined, true);
});