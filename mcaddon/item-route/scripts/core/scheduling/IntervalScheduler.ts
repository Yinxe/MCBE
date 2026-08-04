// ─── 间隔调度抽象（mc 层用 system.runInterval，测试用内存版） ──
export interface IntervalHandle {
  stop(): void;
}

export interface IntervalScheduler {
  createInterval(fn: () => void, tickInterval: number): IntervalHandle;
}

/** 内存实现：advance(ticks) 手动推进，供单测与调试 */
export class MemoryIntervalScheduler implements IntervalScheduler {
  private nextId = 1;
  private intervals = new Map<
    number,
    { fn: () => void; tickInterval: number; counter: number; stopped: boolean }
  >();

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

  /** 推进 N tick，触发所有到期 interval */
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