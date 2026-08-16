// ─── 通用重试（core 层纯逻辑，零 @minecraft 依赖） ─────
// 用于重试"不符合预期"的方法：抛异常 或 返回值不符合预期（谓词判定）都会重试，
// 直到成功或达到最大尝试次数。同步/异步双支持：
//   retrySync(fn)            —— 同步执行体（失败抛 RetryError）
//   retryAsync(fn)           —— 异步执行体（也接受返回普通值的同步函数；失败 reject RetryError）
// 成功判定缺省：返回值非 null/undefined/false 即成功（false 语义=失败，符合"方法返回
// boolean 表示成功"的常见约定）；可用 isSuccess 谓词覆盖（如判定 {ok:true}）。

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
  /** 重试间隔（ms；异步专用；缺省 0 立即重试） */
  delayMs?: number;
  /** 成功判定谓词（缺省：返回值非 null/undefined/false 即成功） */
  isSuccess?: (result: T) => boolean;
  /** 每次重试前回调（attempt = 即将进行的尝试次数，从 2 起） */
  onRetry?: (attempt: number, lastError: unknown, lastResult: unknown) => void;
}

/** 缺省成功判定：false/null/undefined = 不符合预期（重试），其余（含 0/""）成功 */
function defaultIsSuccess<T>(result: T): boolean {
  return result !== null && result !== undefined && result !== false;
}

/**
 * 同步通用重试：执行 fn 直到成功判定通过或达到最大尝试次数。
 * 抛异常与返回值不符合预期（isSuccess 判定）都会触发重试。
 * @param fn 同步执行体（每次尝试重新调用）
 * @param options 重试选项（attempts / isSuccess / onRetry）
 * @returns 首个符合预期的返回值
 * @throws RetryError 全部尝试后仍不符合预期（携带 attempts/lastError/lastResult）
 */
export function retrySync<T>(fn: () => T, options: RetryOptions<T> = {}): T {
  const attempts = Math.max(1, options.attempts ?? 3);
  const isSuccess = options.isSuccess ?? defaultIsSuccess;
  let lastError: unknown;
  let lastResult: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const result = fn();
      if (isSuccess(result)) return result;
      lastError = undefined;
      lastResult = result;
    } catch (e: unknown) {
      lastError = e;
      lastResult = undefined;
    }
    if (i < attempts) options.onRetry?.(i + 1, lastError, lastResult);
  }
  throw new RetryError(`方法重试 ${attempts} 次仍不符合预期`, attempts, lastError, lastResult);
}

/**
 * 异步通用重试：执行 fn（Promise 或普通值）直到成功判定通过或达到最大尝试次数。
 * 抛异常/reject 与返回值不符合预期都会触发重试；重试间隔 delayMs 后重试。
 * @param fn 异步执行体（返回 Promise 或普通值；每次尝试重新调用）
 * @param options 重试选项（attempts / delayMs / isSuccess / onRetry）
 * @returns 首个符合预期的返回值
 * @throws RetryError 全部尝试后仍不符合预期（reject；携带 attempts/lastError/lastResult）
 */
export async function retryAsync<T>(
  fn: () => Promise<T> | T,
  options: RetryOptions<T> = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const isSuccess = options.isSuccess ?? defaultIsSuccess;
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  let lastError: unknown;
  let lastResult: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const result = await fn();
      if (isSuccess(result)) return result;
      lastError = undefined;
      lastResult = result;
    } catch (e: unknown) {
      lastError = e;
      lastResult = undefined;
    }
    if (i < attempts) {
      options.onRetry?.(i + 1, lastError, lastResult);
      if (delayMs > 0) await wait(delayMs);
    }
  }
  throw new RetryError(`方法重试 ${attempts} 次仍不符合预期`, attempts, lastError, lastResult);
}
