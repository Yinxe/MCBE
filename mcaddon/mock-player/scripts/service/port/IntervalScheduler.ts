// ─── IntervalScheduler 端口（core 层） ──────────────────
// 周期调度端口：mc 层实现（system.runInterval 后端）与测试替身（手动推进）共用。
// 让依赖周期的业务逻辑（如行为引擎）可被单测以确定性推进。

export interface IntervalHandle {
  clear(): void;
}

export interface IntervalScheduler {
  createInterval(fn: () => void, tickInterval: number): IntervalHandle;
}

/** 内存调度器（单测替身）：advance 手动推进 tick，interval 到点执行 */
export class MemoryIntervalScheduler implements IntervalScheduler {
  private jobs = new Map<number, { fn: () => void; tickInterval: number; next: number }>();
  private nextId = 1;
  private currentTick = 0;

  createInterval(fn: () => void, tickInterval: number): IntervalHandle {
    const id = this.nextId++;
    this.jobs.set(id, { fn, tickInterval, next: this.currentTick + tickInterval });
    return { clear: () => this.jobs.delete(id) };
  }

  /** 推进 N 个 tick，到点的 interval 按序执行（跨过的周期补执行） */
  advance(ticks = 1): void {
    this.currentTick += ticks;
    for (const job of [...this.jobs.values()]) {
      while (job.next <= this.currentTick) {
        job.fn();
        job.next += job.tickInterval;
      }
    }
  }

  get tick(): number {
    return this.currentTick;
  }

  clearAll(): void {
    this.jobs.clear();
  }
}