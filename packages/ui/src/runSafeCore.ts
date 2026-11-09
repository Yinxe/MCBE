// ─── 安全上下文执行助手(核心,可注入调度器以便单测) ─────────────
//
// 本模块不 import @minecraft,调度器由调用方注入。
// 绑定到 system.run 的实例见 runSafe.ts。
//
// 背景:自定义命令回调与 beforeEvents 回调运行在只读上下文,在其中调用被
// 标注 `can't be called in read-only mode` 的成员会抛错。推迟到安全上下文
// 是引擎级硬约束,详见 docs/research/read-only-context.md。

/** 调度器:把一个函数安排到安全上下文执行。生产环境即 system.run。 */
export type Scheduler = (callback: () => void) => void;

/** 错误回调。 */
export type ErrorHandler = (error: unknown) => void;

/**
 * 构造一对执行助手。
 *
 * - `runSafe(fn)` 返回 Promise:回调成功则 resolve,回调同步抛错或返回的
 *   Promise 被拒绝则 reject。调用方 MUST 处理该 Promise(await + try/catch
 *   或 .catch),否则会成为 unhandled rejection。
 * - `runSafeDetached(fn, onError?)` 不返回 Promise:错误交给 `onError`,
 *   未提供时写入 console.warn。用于无法 await 的位置(如命令注册回调)。
 */
export function createRunSafe(schedule: Scheduler): {
  runSafe: (fn: () => void | Promise<void>) => Promise<void>;
  runSafeDetached: (fn: () => void | Promise<void>, onError?: ErrorHandler) => void;
} {
  function runSafe(fn: () => void | Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      schedule(() => {
        try {
          const returned = fn();
          if (returned && typeof (returned as Promise<void>).then === "function") {
            (returned as Promise<void>).then(resolve, reject);
          } else {
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function runSafeDetached(fn: () => void | Promise<void>, onError?: ErrorHandler): void {
    runSafe(fn).catch((error: unknown) => {
      if (onError) {
        onError(error);
        return;
      }
      console.warn(`[mc-toolchain/ui] 安全上下文回调执行失败: ${String(error)}`);
    });
  }

  return { runSafe, runSafeDetached };
}
