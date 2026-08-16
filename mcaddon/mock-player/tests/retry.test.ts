// ─── core/utils — 通用重试（单一 retry：同步/异步双支持） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { RetryError, retry } from "../scripts/rules/utils/Retry";

// ─── 同步路径（传同步函数） ────────────────────────────

test("retry：同步——前 2 次 false 第 3 次成功 → 返回成功值并回调重试次数（显式 isSuccess）", () => {
  let calls = 0;
  const retries: number[] = [];
  const result = retry(() => {
    calls++;
    return calls >= 3;
  }, { isSuccess: (r) => r === true, onRetry: (attempt) => retries.push(attempt) });
  assert.equal(result, true);
  assert.equal(calls, 3);
  assert.deepEqual(retries, [2, 3]); // 第 2、3 次尝试前回调
});

test("retry：同步——始终 false（显式 isSuccess）→ 抛 RetryError（attempts=3，lastResult=false）", () => {
  assert.throws(
    () => retry(() => false, { attempts: 3, isSuccess: (r) => r === true }),
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

test("retry：同步——抛异常重试 → 第 2 次成功", () => {
  let calls = 0;
  const result = retry(() => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("retry：同步——自定义 isSuccess 谓词（{ok:true} 判定）", () => {
  let calls = 0;
  const result = retry(
    () => {
      calls++;
      return { ok: calls >= 2 };
    },
    { isSuccess: (r) => r.ok === true },
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("retry：同步——attempts=1 不重试，一次异常即抛", () => {
  let calls = 0;
  assert.throws(
    () => retry(() => {
      calls++;
      throw new Error("boom");
    }, { attempts: 1 }),
    RetryError,
  );
  assert.equal(calls, 1);
});

test("retry：同步——缺省判定：不抛异常即成功（false/0/''/null 都直接成功不重试）", () => {
  let calls = 0;
  // false 返回值不再触发重试：一次调用即成功返回
  assert.equal(
    retry(() => {
      calls++;
      return false;
    }),
    false,
  );
  assert.equal(calls, 1);
  assert.equal(retry(() => 0), 0);
  assert.equal(retry(() => ""), "");
  assert.equal(retry(() => null), null);
});

test("retry：同步——异常与返回值不符混合重试（显式 isSuccess）→ 最终成功", () => {
  let calls = 0;
  const result = retry(
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

test("retry：同步——始终抛异常 → RetryError 携带 lastError", () => {
  assert.throws(
    () => retry(() => {
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

// ─── 异步路径（传异步函数） ────────────────────────────

test("retry：异步——前 2 次 reject 第 3 次 resolve → 成功", async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls++;
    if (calls < 3) throw new Error("boom");
    return "done";
  });
  assert.equal(result, "done");
  assert.equal(calls, 3);
});

test("retry：异步——返回值不符合预期（显式 isSuccess）重试", async () => {
  let calls = 0;
  const result = await retry(
    async () => {
      calls++;
      return calls >= 2;
    },
    { isSuccess: (r) => r === true },
  );
  assert.equal(result, true);
  assert.equal(calls, 2);
});

test("retry：异步——接受返回 Promise 的普通函数（非 async 声明）", async () => {
  let calls = 0;
  const result = await retry(() => {
    calls++;
    return new Promise<boolean>((resolve, reject) => {
      if (calls === 1) reject(new Error("boom"));
      else resolve(true);
    });
  });
  assert.equal(result, true);
  assert.equal(calls, 2);
});

test("retry：异步——delayMs 间隔生效（2 次失败 × 20ms ≥ 40ms）", async () => {
  let calls = 0;
  const t0 = Date.now();
  await retry(async () => {
    calls++;
    if (calls < 3) throw new Error("boom");
    return true;
  }, { delayMs: 20 });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 38, `应等待 2 次间隔，实测 ${elapsed}ms`);
});

test("retry：异步——始终失败（显式 isSuccess）→ reject RetryError（含 lastError/lastResult）", async () => {
  await assert.rejects(
    retry(async () => false, { attempts: 2, isSuccess: (r) => r === true }),
    (e: unknown) => {
      assert.ok(e instanceof RetryError);
      const err = e as RetryError;
      assert.equal(err.attempts, 2);
      assert.equal(err.lastResult, false);
      return true;
    },
  );
});

test("retry：异步——自定义 isSuccess + onRetry 回调", async () => {
  let calls = 0;
  const retries: number[] = [];
  const result = await retry(
    async () => {
      calls++;
      return { done: calls >= 2 };
    },
    { isSuccess: (r) => r.done === true, onRetry: (attempt) => retries.push(attempt) },
  );
  assert.equal(result.done, true);
  assert.deepEqual(retries, [2]);
});

test("retry：异步——缺省判定：不抛异常即成功（resolve undefined 也成功）", async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls++;
    return undefined;
  });
  assert.equal(result, undefined);
  assert.equal(calls, 1);
});

// ─── 同步/异步共用同一函数签名 ──────────────────────────

test("retry：同一函数签名——同步 fn 直接返回值，异步 fn 返回 Promise", async () => {
  // 同步：不 await，直接拿值
  const syncValue = retry<number>(() => 42);
  assert.equal(syncValue, 42);
  // 异步：await 拿值
  const asyncValue = await retry<number>(async () => 42);
  assert.equal(asyncValue, 42);
});
