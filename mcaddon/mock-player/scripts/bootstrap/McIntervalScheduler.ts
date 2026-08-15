// ─── runInterval 调度适配（mc 层） ──────────────────────
// 实现 core/storage 的 IntervalScheduler 端口（system.runInterval 后端）。

import { system } from "@minecraft/server";
import type { IntervalHandle, IntervalScheduler } from "../service/port/IntervalScheduler";

export class McIntervalScheduler implements IntervalScheduler {
  createInterval(fn: () => void, tickInterval: number): IntervalHandle {
    const interval = system.runInterval(fn, tickInterval);
    return { clear: () => system.clearRun(interval) };
  }
}
