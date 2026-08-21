// ─── 劫掠领域事件（features/flow 内聚） ──────────────────
// 事件负载只用可序列化 string/number。raidPhase 仅供通知/联动，不参与流程。
// 生产端：raidMode.ts（effectAdd 事件监听）；订阅方按需（通知/统计联动）。

import { EventSignal } from "../../events/EventSignal";

/** 劫掠开始事件：假人获得袭击之兆（不祥之兆在村庄/试炼之地内转化）——劫掠即将开始。
 *  ⚠️ 不祥之兆本身不算劫掠开始（可能 100 分钟挂着或转化为试炼之兆），以转化为准 */
export interface RaidStartedEvent {
  botName: string;
  amplifier: number;
}

/** 劫掠胜利事件：假人获得村庄英雄（袭击结束） */
export interface RaidVictoryEvent {
  botName: string;
  amplifier: number;
}

/** 袭击阶段（核心流程事件驱动；通知玩家用） */
export type RaidPhase =
  | "idle" // 未开始
  | "pre-trigger" // 预触发：获得袭击之兆，30 秒后袭击完全开始
  | "started" // 开始：袭击之兆结束，袭击完全开始
  | "victory" // 胜利：获得村庄英雄
  | "truce"; // 停战：40 分钟未结束，平局

/** 袭击阶段变化事件（通知/外部联动用；不参与核心流程决策） */
export interface RaidPhaseEvent {
  botName: string;
  phase: RaidPhase;
  detail: string;
}

/** 劫掠开始信号 */
export const raidStarted = new EventSignal<RaidStartedEvent>();

/** 劫掠胜利信号 */
export const raidVictory = new EventSignal<RaidVictoryEvent>();

/** 袭击阶段变化信号（仅供通知/联动，不影响核心流程） */
export const raidPhase = new EventSignal<RaidPhaseEvent>();

/** 阶段状态（每假人一份） */
export interface RaidPhaseState {
  phase: RaidPhase;
}

/** 创建初始阶段状态 */
export function initialRaidPhaseState(): RaidPhaseState {
  return { phase: "idle" };
}