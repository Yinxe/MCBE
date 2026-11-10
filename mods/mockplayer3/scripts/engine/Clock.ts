// ─── 单一时钟（全系统唯一 tick 源） ────────────────────────────────
// 1 tick 间隔回调同步广播给订阅者；业务节拍判定一律引用 clock.now()。
// F-18：tick 回调必须同步、短、无 await、无自旋——本回调只广播。

import { system } from "@minecraft/server";

export class Clock {
  private tickCount = 0;
  private intervalId: number | null = null;
  private readonly listeners = new Set<(tick: number) => void>();

  /** 启动单一时钟（幂等；main.ts Phase4 装配时调用一次） */
  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = system.runInterval(() => {
      this.tickCount++;
      // 快照迭代：允许回调内退订，不影响本轮广播
      for (const listener of [...this.listeners]) {
        try {
          listener(this.tickCount);
        } catch (e: any) {
          // 单订阅者抛穿不得瘫痪时钟
          console.error(`[mockplayer3] 时钟订阅者异常: ${e?.message ?? e}`);
        }
      }
    }, 1);
  }

  /** 停钟（测试/卸载用；生产路径不触发） */
  stop(): void {
    if (this.intervalId === null) return;
    system.clearRun(this.intervalId);
    this.intervalId = null;
  }

  /** 当前 tick（未启动时恒 0——判定退化为"全部立即到期"，由装配序保证先启动） */
  now(): number {
    return this.tickCount;
  }

  /**
   * 订阅每 tick 回调（同步执行，必须短——F-18）。
   * @returns 退订函数
   */
  onTick(listener: (tick: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 延时一次性回调；唯一合法定时器入口，禁止散落 system.runTimeout。
   * @param ticks 延时 tick 数（下限 1）
   * @param fn 到期执行的回调
   */
  after(ticks: number, fn: () => void): void {
    system.runTimeout(fn, Math.max(1, Math.floor(ticks)));
  }

  /**
   * 协程式 tick 等待（导航/破坏/钓鱼等长流程节拍基元）；取消由调用方 race token.signal。
   * @param ticks 等待 tick 数（下限 1）
   * @returns 到期 resolve 的 Promise
   */
  sleep(ticks: number): Promise<void> {
    return new Promise((resolve) => {
      system.runTimeout(resolve, Math.max(1, Math.floor(ticks)));
    });
  }
}

/** 进程级单例：engine/application 共用（勿建第二时钟） */
export const clock = new Clock();
