// ─── core/storage — 内存调度器 ─────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryIntervalScheduler } from "../scripts/storage/IntervalScheduler";

test("createInterval：按 tick 间隔触发", () => {
  const scheduler = new MemoryIntervalScheduler();
  let count = 0;
  scheduler.createInterval(() => count++, 10);
  scheduler.advance(9);
  assert.equal(count, 0);
  scheduler.advance(1);
  assert.equal(count, 1);
  scheduler.advance(10);
  assert.equal(count, 2);
});

test("createInterval：跨过多周期补执行", () => {
  const scheduler = new MemoryIntervalScheduler();
  let count = 0;
  scheduler.createInterval(() => count++, 5);
  scheduler.advance(13);
  assert.equal(count, 2); // 5, 10 两个周期
});

test("clear：取消后不再触发", () => {
  const scheduler = new MemoryIntervalScheduler();
  let count = 0;
  const handle = scheduler.createInterval(() => count++, 1);
  scheduler.advance(3);
  assert.equal(count, 3);
  handle.clear();
  scheduler.advance(10);
  assert.equal(count, 3);
});

test("多 interval 独立调度", () => {
  const scheduler = new MemoryIntervalScheduler();
  let a = 0;
  let b = 0;
  scheduler.createInterval(() => a++, 2);
  scheduler.createInterval(() => b++, 3);
  scheduler.advance(6);
  assert.equal(a, 3); // 2,4,6
  assert.equal(b, 2); // 3,6
});

test("tick：推进计数", () => {
  const scheduler = new MemoryIntervalScheduler();
  assert.equal(scheduler.tick, 0);
  scheduler.advance(5);
  assert.equal(scheduler.tick, 5);
});

test("clearAll：清空全部任务", () => {
  const scheduler = new MemoryIntervalScheduler();
  let count = 0;
  scheduler.createInterval(() => count++, 1);
  scheduler.createInterval(() => count++, 1);
  scheduler.clearAll();
  scheduler.advance(10);
  assert.equal(count, 0);
});