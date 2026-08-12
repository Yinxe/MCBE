// ─── 工作流框架测试（core/service/Workflow） ───────────
// 生命周期（init/start/stop/isRunning）+ 管理器（注册/初始化/启停/隔离）+ 独立引擎调度。
// 工作流事件走领域事件模式（core/events/WorkflowEvents，每个事件独立信号），
// 在 workflow-events.test.ts 单独覆盖。

import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryIntervalScheduler } from "../scripts/core/storage/IntervalScheduler";
import { WorkflowManager, type Workflow } from "../scripts/core/service/Workflow";

/** 测试用工作流：记录生命周期调用 */
class TestWorkflow implements Workflow {
  readonly name: string;
  initCalls = 0;
  startCalls: string[] = [];
  stopCalls: string[] = [];
  running = new Set<string>();

  constructor(name: string) {
    this.name = name;
  }

  init(): void {
    this.initCalls++;
  }
  start(botName?: string): void {
    this.running.add(botName ?? "*");
    this.startCalls.push(botName ?? "*");
  }
  stop(botName?: string): void {
    this.running.delete(botName ?? "*");
    this.stopCalls.push(botName ?? "*");
  }
  isRunning(botName?: string): boolean {
    return this.running.has(botName ?? "*");
  }
}

function makeManager(): { manager: WorkflowManager; wfA: TestWorkflow; wfB: TestWorkflow } {
  const manager = new WorkflowManager();
  const wfA = new TestWorkflow("wf-a");
  const wfB = new TestWorkflow("wf-b");
  manager.register(wfA);
  manager.register(wfB);
  return { manager, wfA, wfB };
}

test("注册与查询：list/get/重复注册抛错", () => {
  const { manager, wfA } = makeManager();
  assert.deepEqual(manager.list(), ["wf-a", "wf-b"]);
  assert.equal(manager.get("wf-a"), wfA);
  assert.equal(manager.get("unknown"), undefined);
  assert.throws(() => manager.register(wfA), /重复注册/);
});

test("initAll：初始化全部工作流，单工作流失败隔离", () => {
  const manager = new WorkflowManager();
  const good = new TestWorkflow("good");
  const bad: Workflow = {
    name: "bad",
    init() { throw new Error("boom"); },
    start() {},
    stop() {},
    isRunning: () => false,
  };
  manager.register(good);
  manager.register(bad);
  manager.initAll();
  assert.equal(good.initCalls, 1); // 好工作流正常初始化
  // bad 的 init 抛错被隔离（initAll 不抛出）
});

test("启动/停止：按假人粒度 + 全局", () => {
  const { manager, wfA } = makeManager();
  manager.start("wf-a", "bot1");
  manager.start("wf-a", "bot2");
  assert.equal(wfA.isRunning("bot1"), true);
  assert.equal(wfA.isRunning("bot2"), true);
  assert.equal(manager.isRunning("wf-a", "bot1"), true);
  manager.stop("wf-a", "bot1");
  assert.equal(wfA.isRunning("bot1"), false);
  assert.equal(wfA.isRunning("bot2"), true); // bot2 不受影响
  manager.start("wf-a");
  assert.equal(wfA.isRunning(), true);
});

test("未知工作流：start/stop/isRunning 安全降级", () => {
  const { manager } = makeManager();
  manager.start("unknown"); // 不抛错
  manager.stop("unknown");
  assert.equal(manager.isRunning("unknown"), false);
});

// ─── 独立引擎调度 ──────────────────────────────────────

test("独立引擎：initAll 按 intervalTicks 创建独立周期，到点执行 tick", () => {
  const scheduler = new MemoryIntervalScheduler();
  const manager = new WorkflowManager(scheduler);
  let engineTicks = 0;
  manager.register({
    name: "engine-wf",
    init() {},
    start() {},
    stop() {},
    isRunning: () => false,
    engine: { intervalTicks: 10, tick: () => engineTicks++ },
  });
  manager.initAll();
  assert.equal(engineTicks, 0);
  scheduler.advance(9); // 未到点
  assert.equal(engineTicks, 0);
  scheduler.advance(1); // 到点（tick 10）
  assert.equal(engineTicks, 1);
  scheduler.advance(20); // 跨两个周期
  assert.equal(engineTicks, 3);
});

test("独立引擎：多个工作流各自独立周期，互不干扰", () => {
  const scheduler = new MemoryIntervalScheduler();
  const manager = new WorkflowManager(scheduler);
  let a = 0;
  let b = 0;
  manager.register({
    name: "eng-a", init() {}, start() {}, stop() {}, isRunning: () => false,
    engine: { intervalTicks: 5, tick: () => a++ },
  });
  manager.register({
    name: "eng-b", init() {}, start() {}, stop() {}, isRunning: () => false,
    engine: { intervalTicks: 20, tick: () => b++ },
  });
  manager.initAll();
  scheduler.advance(20);
  assert.equal(a, 4); // 20/5
  assert.equal(b, 1); // 20/20
});

test("独立引擎：shutdown 停止全部引擎（clear 后不再执行）", () => {
  const scheduler = new MemoryIntervalScheduler();
  const manager = new WorkflowManager(scheduler);
  let ticks = 0;
  manager.register({
    name: "eng-shutdown", init() {}, start() {}, stop() {}, isRunning: () => false,
    engine: { intervalTicks: 5, tick: () => ticks++ },
  });
  manager.initAll();
  scheduler.advance(5);
  assert.equal(ticks, 1);
  manager.shutdown();
  scheduler.advance(20);
  assert.equal(ticks, 1); // 引擎已停
});

test("独立引擎：tick 异常隔离（单工作流崩溃不影响其他）", () => {
  const scheduler = new MemoryIntervalScheduler();
  const manager = new WorkflowManager(scheduler);
  let good = 0;
  manager.register({
    name: "eng-bad", init() {}, start() {}, stop() {}, isRunning: () => false,
    engine: { intervalTicks: 5, tick: () => { throw new Error("tick boom"); } },
  });
  manager.register({
    name: "eng-good", init() {}, start() {}, stop() {}, isRunning: () => false,
    engine: { intervalTicks: 5, tick: () => good++ },
  });
  manager.initAll();
  scheduler.advance(10);
  assert.equal(good, 2); // 好引擎不受坏引擎影响
});
