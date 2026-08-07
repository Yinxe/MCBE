import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryIntervalScheduler } from "../scripts/core/scheduling/IntervalScheduler";
import type { IntervalScheduler } from "../scripts/core/scheduling/IntervalScheduler";

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
import { Scheduler, type IndexLifecycle } from "../scripts/core/scheduling/Scheduler";
import { registerContainer } from "../scripts/core/model/ContainerRegistry";
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
    bus
  );
  const scheduler = new Scheduler(router, intervals, proximity, bus, 8, 40, { fallbackIndex: index });
  const containers = new Map<string, InMemoryContainer>();
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers,
    inputs: new Map<string, InMemoryContainer>(),
  };
  return { intervals, proximity, index, router, scheduler, warehouse, containers, bus };
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
  registerContainer(w.warehouse, input);
  registerContainer(w.warehouse, target);
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

test("Scheduler: 快于全局最快速度的仓库被 clamp 降速（v1 口径，合规不动）", () => {
  const w = makeWorld();
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.scheduler.setProcessingSpeed("w1", 4); // 4 tick 快于默认最快 8 → clamp 到 8
  assert.equal(w.scheduler.getIntervalTicks("w1"), 8);
  w.scheduler.setGlobalSpeedLimit(20); // 管理员把最快速度提到 20 → 现速 8 也被降到 20
  assert.equal(w.scheduler.getIntervalTicks("w1"), 20);
  w.scheduler.setProcessingSpeed("w1", 40); // 40 慢于 20，合规不动
  assert.equal(w.scheduler.getIntervalTicks("w1"), 40);
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
test("Scheduler: 激活创建 interval 失败 → 保持 inactive 且可重试", () => {
  const intervals = new MemoryIntervalScheduler();
  let shouldThrow = true;
  const throwingIntervals: IntervalScheduler = {
    createInterval: (fn, t) => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("激活失败");
      }
      return intervals.createInterval(fn, t);
    },
  };
  const proximity = new StubProximity();
  const index = new ItemIndex();
  const bus = new EventBus();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    bus
  );
  const scheduler = new Scheduler(router, throwingIntervals, proximity, bus);
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map<string, InMemoryContainer>(),
    inputs: new Map<string, InMemoryContainer>(),
  };
  scheduler.registerWarehouse(warehouse);
  proximity.setNearby("w1", true);
  scheduler.tick(); // 第一次激活抛错 → 保持 inactive（不卡死在半激活态）
  assert.equal(scheduler.getLifecycle("w1"), "inactive");
  scheduler.tick(); // 重试成功
  assert.equal(scheduler.getLifecycle("w1"), "active");
});

test("Scheduler: 每仓库索引隔离（激活加载/空闲卸载/各仓独立）", () => {
  const intervals = new MemoryIntervalScheduler();
  const proximity = new StubProximity();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const loadedIds: string[] = [];
  const unloadedIds: string[] = [];
  const lifecycle: IndexLifecycle = {
    load: (wh) => {
      loadedIds.push(wh.id);
      return new ItemIndex();
    },
    unload: (wh) => {
      unloadedIds.push(wh.id);
    },
  };
  let fakeNow = 0; // 可注入墙钟：把"空闲 30 分钟"压成可测试的毫秒窗口
  const scheduler = new Scheduler(router, intervals, proximity, new EventBus(), 20, 20, {
    indexLifecycle: lifecycle,
    idleUnloadMs: 1000,
    now: () => fakeNow,
  });
  const mk = (id: string) => ({
    id,
    displayName: id,
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map<string, InMemoryContainer>(),
    inputs: new Map<string, InMemoryContainer>(),
  });
  const w1 = mk("w1");
  const w2 = mk("w2");
  scheduler.registerWarehouse(w1);
  scheduler.registerWarehouse(w2);
  // w1 激活 → 加载 w1 索引；w2 未激活 → 无索引
  proximity.setNearby("w1", true);
  scheduler.tick();
  assert.equal(scheduler.getIndex("w1") !== undefined, true);
  assert.equal(scheduler.getIndex("w2"), undefined);
  assert.deepEqual(loadedIds, ["w1"]);
  // w1 停用（20 宽限）→ inactive，空闲未超时 → 不卸载
  proximity.setNearby("w1", false);
  for (let i = 0; i < 30; i++) scheduler.tick();
  assert.equal(scheduler.getIndex("w1") !== undefined, true); // fakeNow 仍 0，未超 1000ms
  assert.deepEqual(unloadedIds, []);
  // 推进墙钟超过阈值 → 下一次 tick 卸载
  fakeNow = 2000;
  scheduler.tick();
  assert.equal(scheduler.getIndex("w1"), undefined);
  assert.deepEqual(unloadedIds, ["w1"]);
  // 重新激活 → 重新加载（每次独立实例，非共享）
  proximity.setNearby("w1", true);
  scheduler.tick();
  assert.equal(scheduler.getIndex("w1") !== undefined, true);
  assert.deepEqual(loadedIds, ["w1", "w1"]);
});

test("Scheduler: 生命周期迁移触发 lifecycle-changed 事件", () => {
  const w = makeWorld();
  const events: string[] = [];
  // 直接订阅调度器内部用的 bus：makeWorld 未暴露，这里用 scheduler 里的事件总线下发一份
  const probe = new EventBus();
  probe.lifecycleChanged.subscribe((e) => events.push(`${e.from}->${e.to}`));
  // 用 makeWorld 的 scheduler，但其 bus 未导出 → 改为重新构造一个带探针 bus 的调度器
  const intervals2 = new MemoryIntervalScheduler();
  const proximity2 = new StubProximity();
  const router2 = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    probe
  );
  const scheduler2 = new Scheduler(router2, intervals2, proximity2, probe);
  const warehouse = { ...w.warehouse };
  scheduler2.registerWarehouse(warehouse);
  proximity2.setNearby("w1", true);
  scheduler2.tick();
  assert.deepEqual(events, ["inactive->active"]);
  proximity2.setNearby("w1", false);
  scheduler2.tick();
  assert.deepEqual(events, ["inactive->active", "active->deactivating"]);
});

// ── 去游标后：只扫输入 + 优先级排序 + 运转开关 ─────────────────
test("Scheduler: routingEnabled=false 停运该仓，重新开启恢复处理", () => {
  const w = makeWorld();
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const target = new InMemoryContainer("m1", "multi", 3);
  target.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  registerContainer(w.warehouse, input);
  registerContainer(w.warehouse, target);
  w.index.onContainerAdded(input);
  w.index.onContainerAdded(target);
  w.warehouse.settings.routingEnabled = false; // 运转关闭
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.intervals.advance(8);
  assert.equal(input.getItem(0)?.itemId, "minecraft:stone"); // 停运：未移动
  w.warehouse.settings.routingEnabled = true;
  w.intervals.advance(8);
  assert.equal(input.getItem(0), undefined); // 恢复：已路由
});

test("Scheduler: 高优先输入不可路由 → 强制阻塞，不落到次优先", () => {
  const w = makeWorld();
  const high = new InMemoryContainer("inHigh", "input", 3);
  high.priority = 5;
  high.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64)); // stone 无任何候选 → 路由失败
  const low = new InMemoryContainer("inLow", "input", 3);
  low.priority = 20;
  low.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64)); // dirt 有 multi 候选
  const target = new InMemoryContainer("m1", "multi", 3);
  target.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64));
  registerContainer(w.warehouse, high);
  registerContainer(w.warehouse, low);
  registerContainer(w.warehouse, target);
  for (const c of [high, low, target]) w.index.onContainerAdded(c);
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.intervals.advance(8); // 处理 1 槽
  assert.equal(high.getItem(0)?.itemId, "minecraft:stone"); // 高优先卡住
  assert.equal(low.getItem(0)?.itemId, "minecraft:dirt"); // 阻塞：次优先不被处理（拥堵暴露给玩家）
  assert.equal(target.getItem(0)?.amount, 5); // 未被路由
  // 高优先物品疏通后（给 stone 补个可路由目标），次优先才被放行
  const m2 = new InMemoryContainer("m2", "multi", 3);
  m2.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  registerContainer(w.warehouse, m2);
  w.index.onContainerAdded(m2);
  w.intervals.advance(8); // 高优先 stone → m2
  assert.equal(high.getItem(0), undefined);
  w.intervals.advance(8); // 高优先空 → 次优先 dirt → m1
  assert.equal(low.getItem(0), undefined);
  assert.equal(target.getItem(0)?.amount, 10);
});

test("Scheduler: 输入按 priority 升序（都可路由时高优先先处理）", () => {
  const w = makeWorld();
  const high = new InMemoryContainer("inHigh", "input", 3);
  high.priority = 5;
  high.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const low = new InMemoryContainer("inLow", "input", 3);
  low.priority = 20;
  low.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64));
  const mStone = new InMemoryContainer("mS", "multi", 3);
  mStone.setItem(0, new SimpleItemStack("minecraft:stone", 1, 64));
  const mDirt = new InMemoryContainer("mD", "multi", 3);
  mDirt.setItem(0, new SimpleItemStack("minecraft:dirt", 1, 64));
  registerContainer(w.warehouse, high);
  registerContainer(w.warehouse, low);
  registerContainer(w.warehouse, mStone);
  registerContainer(w.warehouse, mDirt);
  for (const c of [high, low, mStone, mDirt]) w.index.onContainerAdded(c);
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.intervals.advance(8); // 第一轮：高优先 stone 先路由
  assert.equal(high.getItem(0), undefined);
  assert.equal(low.getItem(0)?.itemId, "minecraft:dirt"); // 低优先等下一轮
  w.intervals.advance(8); // 第二轮：高优先空 → 低优先 dirt
  assert.equal(low.getItem(0), undefined);
});

test("Scheduler: 路由失败发 input-blocked 事件（防抖通知的数据源）", () => {
  const w = makeWorld();
  const blocks: string[] = [];
  w.bus.inputBlocked.subscribe((e) => blocks.push(`${e.containerId}:${e.itemId}:${e.amount}`));
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64)); // stone 无候选 → 阻塞
  const target = new InMemoryContainer("m1", "multi", 3);
  target.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64));
  registerContainer(w.warehouse, input);
  registerContainer(w.warehouse, target);
  for (const c of [input, target]) w.index.onContainerAdded(c);
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.intervals.advance(8);
  assert.deepEqual(blocks, ["in:minecraft:stone:10"]);
  // 持续阻塞：下一轮不再重复触发（状态迁移语义）
  w.intervals.advance(8);
  assert.deepEqual(blocks, ["in:minecraft:stone:10"]); // 未新增
  // 疏通后（给 stone 补目标）路由成功 → 解除阻塞态
  const m2 = new InMemoryContainer("m2", "multi", 3);
  m2.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  registerContainer(w.warehouse, m2);
  w.index.onContainerAdded(m2);
  w.intervals.advance(8);
  assert.equal(input.getItem(0), undefined); // 已路由
  assert.equal(blocks.length, 1);
  // 再次放入不可路由物品 → 重新进入阻塞态（重新触发）；wood 无任何候选（m1 只存 dirt）
  input.setItem(0, new SimpleItemStack("minecraft:wood", 5, 64));
  w.intervals.advance(8);
  assert.deepEqual(blocks, ["in:minecraft:stone:10", "in:minecraft:wood:5"]);
});

test("Scheduler: 输入阻塞态在输入清空后解除（HUD 不残留堵塞标记，item HUD bug）", () => {
  const w = makeWorld();
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64)); // stone 无候选 → 阻塞
  const target = new InMemoryContainer("m1", "multi", 3);
  target.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64));
  registerContainer(w.warehouse, input);
  registerContainer(w.warehouse, target);
  for (const c of [input, target]) w.index.onContainerAdded(c);
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.intervals.advance(8);
  assert.equal(w.scheduler.blockedInputCount("w1"), 1); // 阻塞态 1
  // 玩家手动清空输入（改箱）→ 该输入变空 → 下一轮 processOnce 自检解除阻塞态
  input.setItem(0, undefined);
  w.intervals.advance(8);
  assert.equal(w.scheduler.blockedInputCount("w1"), 0); // 空输入自检清理阻塞标记（HUD 不再显示堵塞）
});

test("Scheduler: HUD 堵塞数 = 被阻塞态输入的**真实占用格数**（非容器数，item HUD bug）", () => {
  const w = makeWorld();
  // 满 3 格输入，全为不可路由物品（stone 无候选）→ 整箱阻塞
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  input.setItem(1, new SimpleItemStack("minecraft:stone", 10, 64));
  input.setItem(2, new SimpleItemStack("minecraft:stone", 10, 64));
  const target = new InMemoryContainer("m1", "multi", 3);
  target.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64));
  registerContainer(w.warehouse, input);
  registerContainer(w.warehouse, target);
  for (const c of [input, target]) w.index.onContainerAdded(c);
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.intervals.advance(8);
  assert.equal(w.scheduler.blockedInputCount("w1"), 1); // 1 个阻塞容器
  // HUD 口径：按 blockedInputIds 累加 usedSlots → 3 格（满箱如实显示，而非"1 格"）
  let hudBlocked = 0;
  for (const id of w.scheduler.blockedInputIds("w1")) {
    const c = w.warehouse.containers.get(id);
    if (c !== undefined) hudBlocked += c.usedSlots;
  }
  assert.equal(hudBlocked, 3);
});

test("Scheduler: 输入全空 → 无事可作（不产生移动）", () => {
  const w = makeWorld();
  const input = new InMemoryContainer("in", "input", 3);
  const target = new InMemoryContainer("m1", "multi", 3);
  registerContainer(w.warehouse, input);
  registerContainer(w.warehouse, target);
  w.index.onContainerAdded(input);
  w.index.onContainerAdded(target);
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.intervals.advance(16);
  assert.equal(target.getItem(0), undefined);
});

test("Scheduler: 仓库设置缺 blacklist（旧档）→ 空值防护不崩，正常路由", () => {
  const w = makeWorld();
  // 模拟旧档：settings 缺 blacklist 键（undefined）→ 若直接 .includes 会崩整轮
  const legacy = w.warehouse.settings as unknown as Record<string, unknown>;
  delete legacy.blacklist;
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const target = new InMemoryContainer("m1", "multi", 3);
  target.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  registerContainer(w.warehouse, input);
  registerContainer(w.warehouse, target);
  w.index.onContainerAdded(input);
  w.index.onContainerAdded(target);
  w.scheduler.registerWarehouse(w.warehouse);
  w.proximity.setNearby("w1", true);
  w.scheduler.tick();
  w.intervals.advance(8);
  // 不崩且有黑名单项正常路由（stone 到 m1 堆叠）
  assert.equal(input.getItem(0), undefined);
  assert.equal(target.getItem(0)?.amount, 15);
});
