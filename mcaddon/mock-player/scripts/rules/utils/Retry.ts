// ─── 通用重试（core 层纯逻辑，零 @minecraft 依赖） ─────
// 用于重试"不符合预期"的方法：抛异常 或 返回值不符合预期（谓词判定）都会重试，
// 直到成功或达到最大尝试次数。**单一 retry 函数同时支持同步与异步**：
//   retry(fn)             —— 传同步函数：同步执行，失败同步抛 RetryError
//   retry(fn)             —— 传异步函数（async 或返回 Promise）：异步执行，
//                           失败 reject RetryError；重试间隔 delayMs 生效
// 自动分流：首次调用探测返回值——thenable 走异步路径，普通值/同步异常走同步路径。
// 成功判定缺省：**方法不抛异常即成功**（返回值不限——false/null/undefined 也算成功）；
// 需要按返回值判定时传 isSuccess 谓词（如判定 {ok:true}）。

/** 重试耗尽错误（同步抛 / 异步 reject；携带最后一次异常与不符合预期的返回值） */
export class RetryError extends Error {
  constructor(
    message: string,
    /** 实际尝试次数（含首次） */
    readonly attempts: number,
    /** 最后一次异常（返回值不符合预期时无异常） */
    readonly lastError: unknown,
    /** 最后一次不符合预期的返回值（抛异常时无返回值） */
    readonly lastResult: unknown,
  ) {
    super(message);
    this.name = "RetryError";
  }
}

/** 重试选项 */
export interface RetryOptions<T> {
  /** 最大尝试次数（含首次；缺省 3） */
  attempts?: number;
  /** 重试间隔（ms；异步路径专用；缺省 0 立即重试） */
  delayMs?: number;
  /** 成功判定谓词（缺省：方法不抛异常即成功，返回值不限） */
  isSuccess?: (result: T) => boolean;
  /** 每次重试前回调（attempt = 即将进行的尝试次数，从 2 起） */
  onRetry?: (attempt: number, lastError: unknown, lastResult: unknown) => void;
}

/** thenable 判定（Promise 或任意带 then 的对象） */
function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/**
 * 通用重试：执行 fn 直到成功判定通过或达到最大尝试次数。同步/异步双支持——
 * 首次调用探测自动分流：fn 返回 Promise（async 函数）走异步路径（失败 reject
 * RetryError，delayMs 间隔重试）；返回普通值/同步抛异常走同步路径（失败同步抛
 * RetryError）。抛异常与返回值不符合预期（isSuccess 判定）都会触发重试；
 * 未提供 isSuccess 时缺省"方法不抛异常即成功"（返回值不限）。
 * @param fn 执行体（同步函数或异步函数；每次尝试重新调用）
 * @param options 重试选项（attempts / delayMs / isSuccess / onRetry）
 * @returns 首个符合预期的返回值（同步 fn 直接返回；异步 fn 返回 Promise）
 * @throws RetryError 全部尝试后仍不符合预期（同步抛 / 异步 reject）
 */
export function retry<T>(fn: () => Promise<T>, options?: RetryOptions<T>): Promise<T>;
export function retry<T>(fn: () => T, options?: RetryOptions<T>): T;
export function retry<T>(fn: () => T | Promise<T>, options: RetryOptions<T> = {}): T | Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const isSuccess = options.isSuccess ?? (() => true);
  const onRetry = options.onRetry;
  const fail = (lastError: unknown, lastResult: unknown): RetryError =>
    new RetryError(`方法重试 ${attempts} 次仍不符合预期`, attempts, lastError, lastResult);

  // ── 首次调用探测：thenable → 异步路径；普通值/同步异常 → 同步路径 ──
  let firstValue: T | Promise<T> | undefined;
  let firstError: unknown;
  try {
    firstValue = fn();
  } catch (e: unknown) {
    firstError = e;
  }
  const isAsync = firstError === undefined && isThenable(firstValue);

  // ── 同步路径（fn 同步返回普通值/同步抛异常；delayMs 不适用） ──
  if (!isAsync) {
    let lastValue: T | undefined = firstValue as T | undefined;
    let lastError: unknown = firstError;
    for (let i = 1; i <= attempts; i++) {
      if (i > 1) {
        try {
          lastValue = fn() as T;
          lastError = undefined;
        } catch (e: unknown) {
          lastError = e;
          lastValue = undefined;
        }
      }
      if (lastError === undefined && isSuccess(lastValue as T)) return lastValue as T;
      if (i < attempts) onRetry?.(i + 1, lastError, lastValue);
    }
    throw fail(lastError, lastValue);
  }

  // ── 异步路径（fn 返回 Promise；delayMs 间隔重试） ──
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  return (async (): Promise<T> => {
    let lastValue: T | undefined;
    let lastError: unknown;
    for (let i = 1; i <= attempts; i++) {
      if (i > 1) {
        if (delayMs > 0) await wait(delayMs);
        try {
          lastValue = await fn();
          lastError = undefined;
        } catch (e: unknown) {
          lastError = e;
          lastValue = undefined;
        }
      } else {
        try {
          lastValue = (await firstValue) as T;
          lastError = undefined;
        } catch (e: unknown) {
          lastError = e;
        }
      }
      if (lastError === undefined && isSuccess(lastValue as T)) return lastValue as T;
      if (i < attempts) onRetry?.(i + 1, lastError, lastValue);
    }
    throw fail(lastError, lastValue);
  })();
}
