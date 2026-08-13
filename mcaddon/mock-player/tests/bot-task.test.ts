// ─── core/bot — 异步任务框架（Promise/await 阻塞式工作流） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AsyncTaskRunner,
  CancellationToken,
  type BotAsyncTask,
  type BotAsyncTaskContext,
} from "../scripts/core/bot/Task";

test("AsyncTaskRunner：启动 → await 完成 → onDone 触发（含任务 id）", async () => {
  const runner = new AsyncTaskRunner();
  let ran = false;
  const done: string[] = [];
  const task: BotAsyncTask = {
    id: "vault",
    async run(): Promise<void> {
      await Promise.resolve();
      ran = true;
    },
  };
  assert.equal(runner.start(task, new CancellationToken(), (id) => done.push(id)), true);
  assert.equal(runner.activeTaskId, "vault");
  // 等协程完成（微任务）
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ran, true);
  assert.equal(runner.activeTaskId, undefined);
  assert.deepEqual(done, ["vault"]);
});

test("AsyncTaskRunner：一次一活跃任务（互斥，活跃时拒绝）", async () => {
  const runner = new AsyncTaskRunner();
  const taskA: BotAsyncTask = {
    id: "a",
    async run(): Promise<void> {
      await new Promise((r) => setTimeout(r, 30));
    },
  };
  const taskB: BotAsyncTask = { id: "b", async run(): Promise<void> {} };
  assert.equal(runner.start(taskA, new CancellationToken()), true);
  assert.equal(runner.start(taskB, new CancellationToken()), false); // 互斥
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(runner.start(taskB, new CancellationToken()), true); // A 完成后可启动
});

test("AsyncTaskRunner：cancel 置取消标志 + 通知挂起等待（onCancel 立即放行）", async () => {
  const runner = new AsyncTaskRunner();
  let ctxRef: BotAsyncTaskContext | undefined;
  let cancelledSeen = false;
  const task: BotAsyncTask = {
    id: "vault",
    async run(ctx: BotAsyncTaskContext): Promise<void> {
      ctxRef = ctx;
      await new Promise<void>((resolve) => {
        ctx.onCancel(() => resolve()); // 挂起等待：cancel → 立即 resolve
      });
      cancelledSeen = ctx.cancelled;
    },
  };
  runner.start(task, new CancellationToken());
  assert.equal(runner.cancel(), true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cancelledSeen, true); // 协程感知取消
  assert.equal(runner.isRunning(), false);
});

test("AsyncTaskRunner：cancel 后 onCancel 立即回调（已取消时注册）", () => {
  const token = new CancellationToken();
  token.cancel();
  let called = false;
  token.onCancel(() => {
    called = true;
  });
  assert.equal(called, true); // 已取消 → 立即回调
  assert.equal(token.cancelled, true);
});

test("AsyncTaskRunner：任务异常隔离（catch + onDone 仍触发）", async () => {
  const runner = new AsyncTaskRunner();
  const done: string[] = [];
  const task: BotAsyncTask = {
    id: "boom",
    async run(): Promise<void> {
      throw new Error("boom");
    },
  };
  runner.start(task, new CancellationToken(), (id) => done.push(id));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(done, ["boom"]); // 异常后完成回调仍触发
  assert.equal(runner.isRunning(), false);
});
