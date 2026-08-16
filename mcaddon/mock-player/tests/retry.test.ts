// ─── core/utils — 通用重试（同步/异步） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { RetryError, retryAsync, retrySync } from "../scripts/rules/utils/Retry";

// ─── 同步重试 ──────────────────────────────────────────

test("retrySync：前 2 次 false 第 3 次成功 → 返回成功值并回调重试次数（显式 isSuccess）", () => {
  let calls = 0;
  const retries: number[] = [];
  const result = retrySync(() => {
    calls++;
    return calls >= 3;
  }, { isSuccess: (r) => r === true, onRetry: (attempt) => retries.push(attempt) });
  assert.equal(result, true);
  assert.equal(calls, 3);
  assert.deepEqual(retries, [2, 3]); // 第 2、3 次尝试前回调
});

test("retrySync：始终 false（显式 isSuccess）→ 抛 RetryError（attempts=3，lastResult=false）", () => {
  assert.throws(
    () => retrySync(() => false, { attempts: 3, isSuccess: (r) => r === true }),
    (e: unknown) => {
      assert.ok(e instanceof RetryError);
      const err = e as RetryError;
      assert.equal(err.attempts, 3);
      assert.equal(err.lastResult, false);
      assert.equal(err.lastError, undefined);
      return true;
    },
  );
});

test("retrySync：抛异常重试 → 第 2 次成功", () => {
  let calls = 0;
  const result = retrySync(() => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("retrySync：自定义 isSuccess 谓词（{ok:true} 判定）", () => {
  let calls = 0;
  const result = retrySync(
    () => {
      calls++;
      return { ok: calls >= 2 };
    },
    { isSuccess: (r) => r.ok === true },
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("retrySync：attempts=1 不重试，一次异常即抛", () => {
  let calls = 0;
  assert.throws(
    () => retrySync(() => {
      calls++;
      throw new Error("boom");
    }, { attempts: 1 }),
    RetryError,
  );
  assert.equal(calls, 1);
});

test("retrySync：缺省判定——不抛异常即成功（false/0/''/null 都直接成功不重试）", () => {
  let calls = 0;
  // false 返回值不再触发重试：一次调用即成功返回
  assert.equal(
    retrySync(() => {
      calls++;
      return false;
    }),
    false,
  );
  assert.equal(calls, 1);
  assert.equal(retrySync(() => 0), 0);
  assert.equal(retrySync(() => ""), "");
  assert.equal(retrySync(() => null), null);
});

test("retrySync：异常与返回值不符混合重试（显式 isSuccess）→ 最终成功", () => {
  let calls = 0;
  const result = retrySync(
    () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      if (calls === 2) return false;
      return "win";
    },
    { isSuccess: (r) => r === "win" },
  );
  assert.equal(result, "win");
  assert.equal(calls, 3);
});

test("retrySync：始终抛异常 → RetryError 携带 lastError", () => {
  assert.throws(
    () => retrySync(() => {
      throw new Error("always");
    }, { attempts: 2 }),
    (e: unknown) => {
      const err = e as RetryError;
      assert.equal(err.attempts, 2);
      assert.ok(err.lastError instanceof Error);
      assert.equal((err.lastError as Error).message, "always");
      return true;
    },
  );
});

// ─── 异步重试 ──────────────────────────────────────────

test("retryAsync：前 2 次 reject 第 3 次 resolve → 成功", async () => {
  let calls = 0;
  const result = await retryAsync(async () => {
    calls++;
    if (calls < 3) throw new Error("boom");
    return "done";
  });
  assert.equal(result, "done");
  assert.equal(calls, 3);
});

test("retryAsync：返回值不符合预期（显式 isSuccess）重试", async () => {
  let calls = 0;
  const result = await retryAsync(
    async () => {
      calls++;
      return calls >= 2;
    },
    { isSuccess: (r) => r === true },
  );
  assert.equal(result, true);
  assert.equal(calls, 2);
});

test("retryAsync：接受返回普通值的同步函数（缺省判定：抛异常才重试）", async () => {
  let calls = 0;
  const result = await retryAsync(() => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("retryAsync：delayMs 间隔生效（2 次失败 × 20ms ≥ 40ms）", async () => {
  let calls = 0;
  const t0 = Date.now();
  await retryAsync(async () => {
    calls++;
    if (calls < 3) throw new Error("boom");
    return true;
  }, { delayMs: 20 });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 38, `应等待 2 次间隔，实测 ${elapsed}ms`);
});

test("retryAsync：始终失败（显式 isSuccess）→ reject RetryError（含 lastError/lastResult）", async () => {
  await assert.rejects(
    retryAsync(async () => false, { attempts: 2, isSuccess: (r) => r === true }),
    (e: unknown) => {
      assert.ok(e instanceof RetryError);
      const err = e as RetryError;
      assert.equal(err.attempts, 2);
      assert.equal(err.lastResult, false);
      return true;
    },
  );
});

test("retryAsync：自定义 isSuccess + onRetry 回调", async () => {
  let calls = 0;
  const retries: number[] = [];
  const result = await retryAsync(
    async () => {
      calls++;
      return { done: calls >= 2 };
    },
    { isSuccess: (r) => r.done === true, onRetry: (attempt) => retries.push(attempt) },
  );
  assert.equal(result.done, true);
  assert.deepEqual(retries, [2]);
});
