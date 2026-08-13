// ─── core/bot — 假人独立引擎（能力调度 + 任务队列） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { BotEngine, type BotCapability, type BotContext, type BotTask } from "../scripts/core/bot/Engine";

/** 测试上下文工厂（tags + tick） */
function makeCtx(tags: string[] = []): BotContext {
  return { tags, tick: 0 };
}

/** 计数能力工厂（每次 tick 执行 +1） */
function countingCapability(
  id: string,
  interval: number,
  opts?: { tags?: string[] },
): BotCapability & { count: number; disabledCalls: number } {
  const cap = {
    id,
    tickInterval: interval,
    count: 0,
    disabledCalls: 0,
    enabled: opts?.tags
      ? (ctx: BotContext) => opts.tags!.some((t) => ctx.tags.includes(t))
      : undefined,
    tick: (): void => {
      cap.count++;
    },
    onDisabled: (): void => {
      cap.disabledCalls++;
    },
  };
  return cap;
}

test("能力：按 tickInterval 周期触发（每 3 tick 一次）", () => {
  const engine = new BotEngine();
  const cap = countingCapability("cap", 3);
  engine.addCapability(cap);
  const ctx = makeCtx();

  engine.tick(ctx); // 1
  engine.tick(ctx); // 2
  assert.equal(cap.count, 0);
  engine.tick(ctx); // 3 → 触发
  engine.tick(ctx); // 4
  engine.tick(ctx); // 5
  engine.tick(ctx); // 6 → 触发
  assert.equal(cap.count, 2);
});

test("能力：不同间隔独立计数（1tick 与 2tick 交错）", () => {
  const engine = new BotEngine();
  const fast = countingCapability("fast", 1);
  const slow = countingCapability("slow", 2);
  engine.addCapability(fast);
  engine.addCapability(slow);
  const ctx = makeCtx();

  for (let i = 0; i < 6; i++) engine.tick(ctx);
  assert.equal(fast.count, 6);
  assert.equal(slow.count, 3);
});

test("能力：enabled 由标签状态驱动（标签移除自动停用）", () => {
  const engine = new BotEngine();
  const cap = countingCapability("mine", 1, { tags: ["mockplayer:tag:autoMine"] });
  engine.addCapability(cap);

  engine.tick(makeCtx(["mockplayer:tag:autoMine"])); // 启用 → 执行
  engine.tick(makeCtx(["mockplayer:tag:autoMine"])); // 执行
  assert.equal(cap.count, 2);
  assert.equal(cap.disabledCalls, 0);

  engine.tick(makeCtx([])); // 停用 → 不执行 + onDisabled 一次
  engine.tick(makeCtx([])); // 持续停用不再调 onDisabled
  assert.equal(cap.count, 2);
  assert.equal(cap.disabledCalls, 1);

  engine.tick(makeCtx(["mockplayer:tag:autoMine"])); // 重新启用 → 恢复执行
  assert.equal(cap.count, 3);
});

test("任务：start → tick 推进 → isDone 完成回调", () => {
  const engine = new BotEngine();
  const ctx = makeCtx();
  const events: string[] = [];
  let ticks = 0;

  const task: BotTask = {
    id: "navigate",
    start: () => events.push("start"),
    tick: () => {
      ticks++;
      events.push(`tick${ticks}`);
    },
    isDone: () => ticks >= 3,
  };
  engine.onTaskComplete = (id) => events.push(`done:${id}`);

  assert.equal(engine.startTask(task, ctx), true);
  assert.equal(engine.activeTaskId, "navigate");
  assert.deepEqual(events, ["start"]);

  engine.tick(ctx); // tick1（未完成）
  engine.tick(ctx); // tick2
  assert.equal(engine.activeTaskId, "navigate");
  engine.tick(ctx); // tick3 → 完成
  assert.equal(engine.activeTaskId, undefined);
  assert.deepEqual(events, ["start", "tick1", "tick2", "tick3", "done:navigate"]);
});

test("任务：一次一活跃任务（互斥，活跃时拒绝新任务）", () => {
  const engine = new BotEngine();
  const ctx = makeCtx();
  const taskA: BotTask = { id: "a", tick: () => {}, isDone: () => false };
  const taskB: BotTask = { id: "b", tick: () => {}, isDone: () => false };

  assert.equal(engine.startTask(taskA, ctx), true);
  assert.equal(engine.startTask(taskB, ctx), false); // 活跃中拒绝
  assert.equal(engine.activeTaskId, "a");

  engine.cancelTask(ctx);
  assert.equal(engine.activeTaskId, undefined);
  assert.equal(engine.startTask(taskB, ctx), true);
  assert.equal(engine.activeTaskId, "b");
});

test("任务：cancel 触发 cancel 回调 + onTaskCancel", () => {
  const engine = new BotEngine();
  const ctx = makeCtx();
  const events: string[] = [];
  const task: BotTask = {
    id: "nav",
    tick: () => {},
    isDone: () => false,
    cancel: () => events.push("cancel"),
  };
  engine.onTaskCancel = (id) => events.push(`canceled:${id}`);

  engine.startTask(task, ctx);
  assert.equal(engine.cancelTask(ctx), true);
  assert.equal(engine.cancelTask(ctx), false); // 无活跃
  assert.deepEqual(events, ["cancel", "canceled:nav"]);
});

test("异常隔离：能力抛错不影响其他能力与任务", () => {
  const engine = new BotEngine();
  const ctx = makeCtx();
  const boom: BotCapability = {
    id: "boom",
    tickInterval: 1,
    tick: () => {
      throw new Error("boom");
    },
  };
  const good = countingCapability("good", 1);
  engine.addCapability(boom);
  engine.addCapability(good);

  const task: BotTask = { id: "t", tick: () => {}, isDone: () => false };
  engine.startTask(task, ctx);

  engine.tick(ctx);
  engine.tick(ctx);
  assert.equal(good.count, 2); // 能力执行不受影响
  assert.equal(engine.activeTaskId, "t"); // 任务存活
});

test("currentTick：引擎推进计数", () => {
  const engine = new BotEngine();
  const ctx = makeCtx();
  assert.equal(engine.currentTick, 0);
  engine.tick(ctx);
  engine.tick(ctx);
  assert.equal(engine.currentTick, 2);
});

test("能力：removeCapability / hasCapability", () => {
  const engine = new BotEngine();
  const cap = countingCapability("cap", 1);
  engine.addCapability(cap);
  assert.equal(engine.hasCapability("cap"), true);
  engine.removeCapability("cap");
  assert.equal(engine.hasCapability("cap"), false);
});
