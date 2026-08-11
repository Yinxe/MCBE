// ─── 劫掠事件（mock-player 私有） ─────────────────────────
// 劫掠信号只属于假人模块，不放进共享 toolkit（raid 是 mock-player 业务，非通用机制）：
//   喝下不祥之瓶 → 获得不祥之兆 → 触发 raidStarted（袭击开始）
//   袭击获胜     → 获得村庄英雄 → 触发 raidVictory（袭击结束）→ 订阅者喝下一瓶
// 订阅方通过 raidStarted / raidVictory 信号解耦，不直接依赖 raidMode 内部实现。
// 信号机制本身（EventSignal）仍用 @yinxe/toolkit 的通用实现。

import { EventSignal } from "@yinxe/toolkit";

/** 劫掠开始事件：假人喝下不祥之瓶获得不祥之兆（袭击将触发） */
export interface RaidStartedEvent {
  /** 假人名 */
  botName: string;
  /** 不祥之兆等级 */
  amplifier: number;
}

/** 劫掠胜利事件：假人获得村庄英雄（袭击结束） */
export interface RaidVictoryEvent {
  /** 假人名 */
  botName: string;
  /** 村庄英雄等级 */
  amplifier: number;
}

/** 劫掠开始信号 */
export const raidStarted = new EventSignal<RaidStartedEvent>();

/** 劫掠胜利信号 */
export const raidVictory = new EventSignal<RaidVictoryEvent>();
