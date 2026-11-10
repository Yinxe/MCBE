// ─── 间隔调度抽象（mc 层用 system.runInterval，测试用内存版） ──
// Scheduler 依赖 IntervalScheduler 而非直接碰 system：可测性（MemoryIntervalScheduler
// 由测试手动 advance）与生产（McIntervalScheduler 包装 system.runInterval）双实现。
/** 间隔句柄：停止该 interval */
export interface IntervalHandle {
  stop(): void;
}

/** 创建按 tick 间隔重复触发的回调 */
export interface IntervalScheduler {
  createInterval(fn: () => void, tickInterval: number): IntervalHandle;
}

/** 内存实现：advance(ticks) 手动推进，供单测与调试（不依赖 @minecraft/system） */
export class MemoryIntervalScheduler implements IntervalScheduler {
  private nextId = 1;
  private intervals = new Map<number, { fn: () => void; tickInterval: number; counter: number; stopped: boolean }>();

  createInterval(fn: () => void, tickInterval: number): IntervalHandle {
    const id = this.nextId++;
    this.intervals.set(id, { fn, tickInterval, counter: 0, stopped: false });
    return {
      stop: () => {
        const entry = this.intervals.get(id);
        if (entry) entry.stopped = true;
      },
    };
  }

  /**
   * 推进 N tick：每 tick 递增所有未停止 interval 的计数器，到间隔整数倍时触发其回调。
   *
   * @param ticks - 推进的 tick 数
   */
  advance(ticks: number): void {
    for (let t = 0; t < ticks; t++) {
      for (const entry of [...this.intervals.values()]) {
        if (entry.stopped) continue;
        entry.counter++;
        if (entry.counter % entry.tickInterval === 0) {
          entry.fn();
        }
      }
    }
  }
}
