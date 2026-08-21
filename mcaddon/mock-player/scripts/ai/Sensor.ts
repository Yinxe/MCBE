// ─── 感受器（core/ai） ─────────────────────────────
// 感知环境 → 写共享记忆（wiki 记忆行为系统的 Sensor → Memory）。
// 每个感受器有独立刷新周期（interval tick），由大脑每 tick 调用
// maybeSense 自计间隔，避免每次扫描（如实体查询）高频执行。

import type { AiMemory } from "./Memory";

/** 感受器上下文（大脑注入：botName + 共享记忆 + 引擎 tick） */
export interface AiSensorContext {
  botName: string;
  memory: AiMemory;
  tick: number;
}

/** 感受器：按周期感知环境并写入共享记忆 */
export interface AiSensor {
  name: string;
  /** 刷新周期（tick） */
  interval: number;
  /** 感知并写记忆（副作用收敛于此；异常由大脑兜底） */
  sense(ctx: AiSensorContext): void;
}

/** 感受器周期调度（内部自计 tick 差；interval 未到不重跑） */
export class SensorRunner {
  private lastTick = new Map<string, number>();

  /**
   * @param sensors 感受器列表
   * @param offset  首次执行错峰偏移（tick，0=首次立即执行）——3.3.21：
   *                感知是同步执行，所有假人的到期感受器集中在同一引擎
   *                tick 串行跑（单 tick 阻塞 = 各扫描之和）。错峰让不同
   *                感受器（序号 ×12）与不同假人（名字哈希偏移）首次执行
   *                分散到不同 tick，避免齐发叠加。
   */
  constructor(
    private readonly sensors: readonly AiSensor[],
    offset = 0
  ) {
    for (let i = 0; i < sensors.length; i++) {
      const sensor = sensors[i]!;
      const off = (offset + i * 12) % sensor.interval;
      this.lastTick.set(sensor.name, -sensor.interval + off); // 首次在 off tick 执行
    }
  }

  /**
   * 每 tick 调用：对到期感受器执行 sense。
   * @param ctx 感受器上下文
   */
  step(ctx: AiSensorContext): void {
    for (const sensor of this.sensors) {
      const last = this.lastTick.get(sensor.name) ?? -Infinity;
      if (ctx.tick - last < sensor.interval) continue;
      this.lastTick.set(sensor.name, ctx.tick);
      try {
        sensor.sense(ctx);
      } catch (e: any) {
        // 打印完整错误 + 栈（3.3.18：此前静默吞——扫描/感知异常完全不可见，
        // 崩溃与行为异常无法诊断）
        console.error(
          `[MockPlayer] 感受器异常 ${sensor.name}(${ctx.botName}) tick=${ctx.tick}: ${e?.message ?? e}\n${e?.stack ?? ""}`
        );
      }
    }
  }
}
