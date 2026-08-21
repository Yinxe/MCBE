// ─── UI 领域事件（core 层） ──────────────────────────────
// UI 表单/面板提交 → 领域事件 → 各功能模块独立订阅（完全解耦）：
//   UI 层只发布事件（不知道任何功能模块）；功能模块只订阅事件（不知道 UI 细节），
//   各自感知负载里自己感兴趣的字段/动作再执行。
// 事件负载只用可序列化的 string/number——保持 core 纯净可单测。
// ⚠️ 行为菜单的标签在发布前已由 UI 先落库（setTags），负载 tags 与 record.tags 一致，
//    订阅方按事件负载或 record.tags 判断结果相同，无时序依赖。

import { EventSignal } from "./EventSignal";

// ─── BOT 主菜单（showBotPanel） ─────────────────────────

/** BOT 主菜单面板动作 */
export type BotPanelAction =
  | "toggleOnline"
  | "tpToBot"
  | "syncPose"
  | "selectMainhand"
  | "swap"
  | "reclaim"
  | "discard"
  | "useItem"
  | "openBehavior"
  | "updateSpawn"
  | "rename"
  | "throwTrident"
  | "claimTrident"
  | "viewData"
  | "kill"
  | "delete";

/** BOT 主菜单动作事件：按钮点击（操作者 + 目标假人 + 动作） */
export interface BotPanelActionEvent {
  /** 操作者玩家实体 ID（订阅方据此解析 Player） */
  playerId: string;
  /** 目标假人名 */
  botName: string;
  /** 面板动作 */
  action: BotPanelAction;
}

/** BOT 主菜单动作信号 */
export const botPanelAction = new EventSignal<BotPanelActionEvent>();

// ─── 行为菜单（showTagManagement 提交） ─────────────────

/** 行为菜单提交事件：表单全字段快照（标签已由 UI 先落库，tags 与 record.tags 一致） */
export interface BehaviorSubmittedEvent {
  /** 操作者玩家实体 ID */
  playerId: string;
  /** 目标假人名 */
  botName: string;
  /** 潜行开关 */
  sneaking: boolean;
  /** 强加载模式开关 */
  chunkload: boolean;
  /** 自动跟随开关（record.following 状态，独立 toggle 不落标签） */
  follow: boolean;
  /** 使用物品（一次性：勾选=使用一次，取消=停止） */
  useItem: boolean;
  /** 勾选的共存标签（不含 bot 标识标签） */
  coexist: string[];
  /** 工作模式（单选互斥：none/wander/mine/place/attack/raid/fishing；发布前已落库） */
  workMode: string;
  /** 完整新标签集（含 bot 标识标签；发布前已写入 record.tags） */
  tags: string[];
}

/** 行为菜单提交信号 */
export const behaviorSubmitted = new EventSignal<BehaviorSubmittedEvent>();

// ─── 聚合导出 ──────────────────────────────────────────
// UI 领域事件统一走 BotUiEvent 命名空间：
//   import { BotUiEvent } from ".../UiEvents"
//   BotUiEvent.panelAction.trigger({ ... }) / BotUiEvent.behaviorSubmitted.subscribe(...)

/** 全部 UI 领域事件聚合（每个事件一个独立信号） */
export const BotUiEvent = {
  panelAction: botPanelAction,
  behaviorSubmitted,
};
