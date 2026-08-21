// ─── 取消令牌（core 层，零 mcapi 纯 TS） ────────────────
// 异步任务主动取消能力（AbortSignal 轻量版）。解决"异步函数怎么提供
// 终止任务的取消能力"：
//   - 任务持有 token，在每个**检测点**轮询 cancelled（粒度自定，如每 tick）；
//   - 调用方 cancel() 幂等置位 + resolve signal——正在 await 的任务可经
//     Promise.race([wait, token.signal]) **立即被唤醒**，不用等定时器到期；
//   - 与裸 shouldStop 回调的区别：可传递/可组合（一个 token 传给多个协程）、
//     无闭包捕获竞态、signal 提供事件驱动唤醒通道（非纯轮询）。
//
// 使用方：blockBreak（breakBlockOnce/breakBlockAt 的 token 选项）、
// 以及其它长协程（导航/钓鱼等）如需取消统一复用。

/** 可复用一次性取消令牌 */
export interface CancelToken {
  /** 是否已请求取消（幂等；任务在每个检测点读它 → 退出） */
  readonly cancelled: boolean;
  /** 取消信号：cancel() 时 resolve。任务可 await（Promise.race 唤醒） */
  readonly signal: Promise<void>;
  /** 请求取消（幂等：多次调用无副作用；触发 signal resolve） */
  cancel(): void;
}

/** 创建取消令牌 */
export function createCancelToken(): CancelToken {
  let resolveSignal: (() => void) | undefined;
  let cancelled = false;
  const signal = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  return {
    get cancelled(): boolean {
      return cancelled;
    },
    signal,
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      resolveSignal?.();
    },
  };
}