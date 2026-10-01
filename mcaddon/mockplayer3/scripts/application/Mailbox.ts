// ─── 每假人管线邮箱（管线串行化唯一入口） ──────────────────────────
// 同一 botId 1 执行 + 1 排队：同标签幂等合并，异标签替换排队位（旧意图 resolve null）。
// 任务抛穿按失败 resolve null 并留错误日志，队列绝不卡死。

interface Slot {
  label: string;
  task: () => Promise<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
}

interface Queue {
  running: boolean;
  pending: Slot | null;
}

/** 管线任务标签（重复合并键） */
export type PipelineLabel = "online" | "offline" | "reclaim" | "reconnect" | "delete" | "restore";

export class Mailbox {
  private readonly queues = new Map<number, Queue>();

  /**
   * 投递管线任务。死亡管线回调窗口内的同步段不得经由邮箱投递（见 Lifecycle.handleDeath）。
   * @param botId - 目标假人（队列键）
   * @param label - 意图标签；与排队中任务同标签时合并，返回既有 Promise
   * @param task - 异步任务；队列空闲则立即开始执行
   * @returns 任务结果；被替换、作废或异常时为 null
   */
  post<R>(botId: number, label: PipelineLabel, task: () => Promise<R>): Promise<R | null> {
    let q = this.queues.get(botId);
    if (!q) {
      q = { running: false, pending: null };
      this.queues.set(botId, q);
    }
    if (q.pending && q.pending.label === label) return q.pending.promise as Promise<R | null>;
    if (q.pending) {
      q.pending.resolve(null);
      q.pending = null;
    }
    let resolveFn!: (value: R | null) => void;
    const promise = new Promise<R | null>((res) => {
      resolveFn = res;
    });
    q.pending = { label, task, promise, resolve: resolveFn as (value: unknown) => void };
    if (!q.running) void this.drain(botId);
    return promise;
  }

  /** 是否已有同标签意图在排队（幂等提示用） */
  hasPending(botId: number, label: PipelineLabel): boolean {
    const q = this.queues.get(botId);
    return q?.pending?.label === label;
  }

  /** 会话销毁/删除：作废排队意图；执行中任务由其自身状态守卫自然收敛 */
  forget(botId: number): void {
    const q = this.queues.get(botId);
    if (!q) return;
    if (q.pending) {
      q.pending.resolve(null);
      q.pending = null;
    }
    if (!q.running) this.queues.delete(botId);
  }

  // ─── 私有 ──

  private async drain(botId: number): Promise<void> {
    const q = this.queues.get(botId);
    if (!q) return;
    q.running = true;
    while (q.pending) {
      const slot = q.pending;
      q.pending = null;
      try {
        slot.resolve(await slot.task());
      } catch (e: any) {
        console.error(`[mockplayer3] 邮箱任务异常 bot=${botId} ${slot.label}: ${e?.message ?? e}`);
        slot.resolve(null);
      }
    }
    q.running = false;
    if (!q.pending) this.queues.delete(botId);
  }
}
