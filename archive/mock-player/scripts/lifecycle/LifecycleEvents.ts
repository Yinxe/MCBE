// ─── 生命周期领域事件（事件驱动核心） ─────────────────
// 所有生命周期阶段均以事件形式广播，组件可订阅而不必实现 hook 接口。
// 事件负载仅用可序列化 string/number/boolean，避免携带 mc 对象。
// 与 DomainEvents (BotEvents) 互补：LifecycleEvents 关注“编排时机”
// （before/after 各阶段），DomainEvents 关注“业务已发生事实”。
// 任何组件既可通过实现 LifecycleComponent 接口的 hook 被动调用，
// 也可直接订阅本文件信号主动响应——双通道保证最大解耦。

import { EventSignal } from "../events/EventSignal";
import type { BotRecord } from "../rules/Types";

// ─── 事件负载类型 ────────────────────────────────────

export interface CreateContext {
  /** 规范化后完整名（含 sim- 前缀） */
  name: string;
  ownerName: string;
  dimension: string;
  location: { x: number; y: number; z: number };
}

export interface OnlineContext {
  botName: string;
  location: { x: number; y: number; z: number };
  dimension: string;
}

export interface OfflineContext {
  botName: string;
  reason?: string;
}

export interface DeleteContext {
  botName: string;
  reclaimed: boolean;
}

export interface LifecycleErrorEvent {
  /** 阶段名：beforeCreate / online / offline / delete / spawn ... */
  phase: string;
  botName: string;
  error: string;
}

export interface AuxCompletedEvent {
  botName: string;
  ownerName?: string;
  dimension: string;
  location: { x: number; y: number; z: number };
  success: boolean;
  reason?: string;
  fallback?: boolean;
}

// ─── 信号定义 ────────────────────────────────────────

// 创建
export const beforeCreate = new EventSignal<CreateContext>();
export const afterCreate = new EventSignal<{ record: BotRecord }>();
export const createFailed = new EventSignal<LifecycleErrorEvent>();

// 上线
export const beforeOnline = new EventSignal<{ botName: string }>();
export const afterOnline = new EventSignal<OnlineContext>();
export const onlineFailed = new EventSignal<LifecycleErrorEvent>();

// 下线
export const beforeOffline = new EventSignal<{ botName: string }>();
export const afterOffline = new EventSignal<OfflineContext>();
export const offlineFailed = new EventSignal<LifecycleErrorEvent>();

// 删除
export const beforeDelete = new EventSignal<{ botName: string }>();
export const afterDelete = new EventSignal<DeleteContext>();
export const deleteFailed = new EventSignal<LifecycleErrorEvent>();

// 击杀 / 死亡 / 复活
export const beforeKill = new EventSignal<{ botName: string }>();
export const afterDeath = new EventSignal<{ botName: string; dimension: string; position: { x: number; y: number; z: number } }>();
export const afterRespawn = new EventSignal<{ botName: string }>();

// 世界加载
export const worldLoad = new EventSignal<{ restoredCount: number }>();

// 辅助常加载（共享瞬时）完成 - 异步通知
export const auxCompleted = new EventSignal<AuxCompletedEvent>();

// 通用错误
export const lifecycleError = new EventSignal<LifecycleErrorEvent>();

/** 聚合导出，方便 import { LifecycleEvents } from "..." */
export const LifecycleEvents = {
  beforeCreate,
  afterCreate,
  createFailed,
  beforeOnline,
  afterOnline,
  onlineFailed,
  beforeOffline,
  afterOffline,
  offlineFailed,
  beforeDelete,
  afterDelete,
  deleteFailed,
  beforeKill,
  afterDeath,
  afterRespawn,
  worldLoad,
  auxCompleted,
  lifecycleError,
};
