// ─── core/utils — 取消令牌（主动取消能力） ────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { createCancelToken } from "../scripts/rules/utils/CancelToken";

test("createCancelToken：未取消时 cancelled=false，signal pending", () => {
  const token = createCancelToken();
  assert.equal(token.cancelled, false);
  // signal 应是未完成的 Promise（pending）——通过 then 不会立刻触发
});

test("createCancelToken：cancel() 置位 cancelled + resolve signal", async () => {
  const token = createCancelToken();
  let woke = false;
  void token.signal.then(() => (woke = true));
  assert.equal(token.cancelled, false);
  token.cancel();
  assert.equal(token.cancelled, true);
  await Promise.resolve(); // 让 microtask 跑完（signal resolve 回调）
  assert.equal(woke, true, "cancel() 后 signal 应已 resolve");
});

test("createCancelToken：cancel() 幂等（多次调用无副作用）", () => {
  const token = createCancelToken();
  token.cancel();
  token.cancel();
  token.cancel();
  assert.equal(token.cancelled, true);
});

test("取消令牌可用于 Promise.race 立即唤醒等待（主动取消核心）", async () => {
  const token = createCancelToken();
  let raceResolved: string | undefined;
  // 模拟一个"会迟到很久"的等待（此处用永不 resolve 的占位 + race 取消）
  const never = new Promise<string>(() => {});
  void Promise.race([never, token.signal.then(() => "cancelled")]).then((v) => (raceResolved = v));
  token.cancel();
  // cancel() 后 signal resolve → race 协调：多轮 microtask 让 .then 链跑完
  await token.signal;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(raceResolved, "cancelled", "cancel() 应唤醒 race 中的等待");
});

test("未 cancel 的 signal 不误唤醒 race", async () => {
  const token = createCancelToken();
  let neverWoke = false;
  const never = new Promise<string>(() => {});
  void Promise.race([never, token.signal]).then(() => (neverWoke = true));
  await Promise.resolve();
  assert.equal(neverWoke, false, "未取消时 race 应停在 pending");
});
