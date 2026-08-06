// ─── 间隔调度器：IntervalScheduler 生产实现（包装 system.runInterval） ──
// 调度轮询（路由/生命周期）的真实定时器后端；测试用 MemoryIntervalScheduler 替代。
import { system } from "@minecraft/server";
import type { IntervalHandle, IntervalScheduler } from "../../core/scheduling/IntervalScheduler";

/** 包装 system.runInterval：返回可显式停止的句柄 */
export class McIntervalScheduler implements IntervalScheduler {
  createInterval(fn: () => void, tickInterval: number): IntervalHandle {
    const id = system.runInterval(fn, tickInterval);
    return {
      stop: () => system.clearRun(id),
    };
  }
}
