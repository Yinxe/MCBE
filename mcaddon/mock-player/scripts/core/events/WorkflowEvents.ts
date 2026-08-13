// ─── 工作流领域事件（core 层） ────────────────────────
// 工作流对外事件采用领域事件模式（与 BotEvents 同风格）：
// **每个事件一个独立信号**（EventSignal），聚合到 BotWorkflowEvent 命名空间，
// 订阅方按事件类型精确订阅，不做统一总线合并。
// 事件负载只用可序列化的 string/number——保持 core 纯净。

import { EventSignal } from "./EventSignal";

// ─── 劫掠工作流（raid-mode） ──────────────────────────

/** 劫掠开始事件：喝下不祥之瓶获得不祥之兆（袭击将触发） */
export interface WorkflowRaidStartedEvent {
  botName: string;
  /** 不祥之兆等级 */
  amplifier: number;
}

/** 劫掠胜利事件：获得村庄英雄（袭击结束） */
export interface WorkflowRaidVictoryEvent {
  botName: string;
  /** 累计胜利次数 */
  wins: number;
}

/** 劫掠开始信号 */
export const workflowRaidStarted = new EventSignal<WorkflowRaidStartedEvent>();

/** 劫掠胜利信号 */
export const workflowRaidVictory = new EventSignal<WorkflowRaidVictoryEvent>();

// ─── 宝库工作流（vault-mode） ──────────────────────────

/** 宝库开箱成功事件：钥匙消耗并打开宝库 */
export interface WorkflowVaultOpenedEvent {
  botName: string;
  /** 消耗的钥匙类型 ID */
  keyType: string;
  /** 剩余钥匙数量 */
  remaining: number;
}

/** 宝库开箱成功信号 */
export const workflowVaultOpened = new EventSignal<WorkflowVaultOpenedEvent>();

// ─── 聚合导出 ──────────────────────────────────────────
// 工作流领域事件统一走 BotWorkflowEvent 命名空间：
//   import { BotWorkflowEvent } from ".../WorkflowEvents"
//   BotWorkflowEvent.raidVictory.subscribe(({ botName, wins }) => { ... })
// ⚠️ 三叉戟认主不属于工作流事件（自定义机制）：信号唯一真源在 DomainEvents（BotEvents）。

/** 全部工作流领域事件聚合（每个事件一个独立信号） */
export const BotWorkflowEvent = {
  // 劫掠
  raidStarted: workflowRaidStarted,
  raidVictory: workflowRaidVictory,
  // 宝库
  vaultOpened: workflowVaultOpened,
};
