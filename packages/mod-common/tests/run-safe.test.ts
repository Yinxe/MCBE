// ─── 安全上下文执行助手的单元测试(注入假调度器,不加载游戏运行时) ──

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunSafe, type Scheduler } from "../src/runSafeCore";

/** 假调度器:记录被安排的回调,由测试显式触发,便于断言「推迟」语义。 */
function makeScheduler(): { schedule: Scheduler; runPending: () => void; pendingCount: () => number } {
  const queue: Array<() => void> = [];
  return {
    schedule: (callback: () => void) => {
      queue.push(callback);
    },
    runPending: () => {
      const drained = queue.splice(0, queue.length);
      for (const callback of drained) callback();
    },
    pendingCount: () => queue.length,
  };
}

test("runSafe 在调度前不执行回调", async () => {
  const fake = makeScheduler();
  const { runSafe } = createRunSafe(fake.schedule);

  let executed = false;
  const promise = runSafe(() => {
    executed = true;
  });

  assert.equal(executed, false, "回调必须等调度器触发后才执行");
  assert.equal(fake.pendingCount(), 1);

  fake.runPending();
  await promise;
  assert.equal(executed, true);
});

test("runSafe 正常返回时 resolve", async () => {
  const fake = makeScheduler();
  const { runSafe } = createRunSafe(fake.schedule);

  const promise = runSafe(() => {
    // 无返回值
  });
  fake.runPending();
  await assert.doesNotReject(promise);
});

test("runSafe 在回调同步抛错时 reject", async () => {
  const fake = makeScheduler();
  const { runSafe } = createRunSafe(fake.schedule);

  const promise = runSafe(() => {
    throw new Error("同步失败");
  });
  fake.runPending();
  await assert.rejects(promise, /同步失败/);
});

test("runSafe 在回调返回的 Promise 被拒绝时 reject", async () => {
  const fake = makeScheduler();
  const { runSafe } = createRunSafe(fake.schedule);

  const promise = runSafe(async () => {
    await Promise.resolve();
    throw new Error("异步失败");
  });
  fake.runPending();
  await assert.rejects(promise, /异步失败/);
});

test("runSafe 等待回调返回的 Promise 完成", async () => {
  const fake = makeScheduler();
  const { runSafe } = createRunSafe(fake.schedule);

  let finished = false;
  const promise = runSafe(async () => {
    await Promise.resolve();
    finished = true;
  });
  fake.runPending();
  await promise;
  assert.equal(finished, true);
});

test("runSafeDetached 同步抛错时交给错误回调,不产生 unhandled rejection", async () => {
  const fake = makeScheduler();
  const { runSafeDetached } = createRunSafe(fake.schedule);

  const captured: unknown[] = [];
  runSafeDetached(
    () => {
      throw new Error("同步失败");
    },
    (error) => captured.push(error),
  );
  fake.runPending();
  // 等一个微任务周期,让 catch 分支跑完
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(captured.length, 1);
  assert.match(String(captured[0]), /同步失败/);
});

test("runSafeDetached 异步拒绝时交给错误回调", async () => {
  const fake = makeScheduler();
  const { runSafeDetached } = createRunSafe(fake.schedule);

  const captured: unknown[] = [];
  runSafeDetached(
    async () => {
      throw new Error("异步失败");
    },
    (error) => captured.push(error),
  );
  fake.runPending();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(captured.length, 1);
  assert.match(String(captured[0]), /异步失败/);
});

test("runSafeDetached 未提供错误回调时不抛出", async () => {
  const fake = makeScheduler();
  const { runSafeDetached } = createRunSafe(fake.schedule);

  assert.doesNotThrow(() => {
    runSafeDetached(() => {
      throw new Error("无人接收");
    });
  });
  fake.runPending();
  await Promise.resolve();
  await Promise.resolve();
});
