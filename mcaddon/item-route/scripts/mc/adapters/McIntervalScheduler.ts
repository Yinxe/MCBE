// ─── 间隔调度器：IntervalScheduler 实现（system.runInterval） ──
import { system } from "@minecraft/server";
import type { IntervalHandle, IntervalScheduler } from "../../core/scheduling/IntervalScheduler";

export class McIntervalScheduler implements IntervalScheduler {
  createInterval(fn: () => void, tickInterval: number): IntervalHandle {
    const id = system.runInterval(fn, tickInterval);
    return {
      stop: () => system.clearRun(id),
    };
  }
}