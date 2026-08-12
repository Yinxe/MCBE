// ─── 工作流框架测试（core/service/Workflow） ───────────
// 生命周期（init/start/stop/isRunning）+ 事件机制 + 管理器（注册/初始化/启停/隔离）。

import { test } from "node:test";
import assert from "node:assert/strict";

import { EventSignal } from "../scripts/core/events/EventSignal";
import { WorkflowManager, type Workflow, type WorkflowEvent } from "../scripts/core/service/Workflow";

/** 测试用工作流：记录生命周期调用，发布事件 */
class TestWorkflow implements Workflow {
  readonly name: string;
  readonly events = new EventSignal<WorkflowEvent>();
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
    events: new EventSignal(),
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

test("工作流事件：订阅/触发/负载传递/异常隔离", () => {
  const wf = new TestWorkflow("wf-events");
  const received: WorkflowEvent[] = [];
  const boom = () => { throw new Error("subscriber boom"); };
  wf.events.subscribe(boom); // 崩溃订阅者
  wf.events.subscribe((e) => received.push(e)); // 正常订阅者不受影响

  const event: WorkflowEvent = { workflow: "wf-events", type: "victory", botName: "bot1", data: { wins: 3 } };
  wf.events.trigger(event);

  assert.equal(received.length, 1);
  assert.equal(received[0]!.type, "victory");
  assert.deepEqual(received[0]!.data, { wins: 3 });
});

test("取消订阅后不再收到事件", () => {
  const wf = new TestWorkflow("wf-unsub");
  let count = 0;
  const unsub = wf.events.subscribe(() => count++);
  wf.events.trigger({ workflow: "wf-unsub", type: "x" });
  unsub();
  wf.events.trigger({ workflow: "wf-unsub", type: "x" });
  assert.equal(count, 1);
});
