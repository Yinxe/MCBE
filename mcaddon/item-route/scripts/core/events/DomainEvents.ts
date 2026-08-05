// ─── 领域事件类型与事件总线 ──────────────────────────────
// core 与 mc 之间的"失联通讯"。core 只负责触发（生产者在 core 内部），
// mc 适配层订阅（消费者），实现「core 无状态、适配层做副作用」的六边形边界。
//
// 各事件生产者/消费者（审查对照）：
//   · itemRouted    —— Router 路由成功后触发；McEventBridge 订阅 → 标记索引脏 + 统计失效
//   · containerChanged —— 容器内容/注册变化触发；索引/统计联动
//   · indexUpdated  —— 预留（当前未消费，为搜索/展示留口）
//   · statsChanged  —— 预留（统计联动）
//   · warning       —— StatsService.evaluateWarnings 触发；WarningRelay 订阅 → 播报附近玩家
//   · visualEffect  —— 装配层（命令/交互）触发；SortEffects/BoundaryDisplay 订阅 → 播放
// 关键约束：事件负载只用可序列化的 string/number，不携带 mc 对象——保证 core 纯净、
// 且事件可安全穿越适配层边界。
import { EventSignal } from "./EventSignal";
import type { ContainerId, ItemId, WarehouseId } from "../model/types";

// ── 事件负载 ─────────────────────────────────────────────
export interface ItemRoutedEvent {
  type: "item-routed";
  warehouseId: WarehouseId;
  from: ContainerId;
  to: ContainerId;
  itemId: ItemId;
  amount: number;
}

export interface ContainerChangedEvent {
  type: "container-changed";
  warehouseId: WarehouseId;
  containerId: ContainerId;
}

export interface IndexUpdatedEvent {
  type: "index-updated";
  warehouseId: WarehouseId;
  itemId: ItemId;
  candidates: ContainerId[];
}

export interface StatsChangedEvent {
  type: "stats-changed";
  warehouseId: WarehouseId;
  containerId?: ContainerId;
}

export type WarningLevel = "yellow" | "red" | "deep-red";

export interface WarningEvent {
  type: "warning";
  warehouseId: WarehouseId;
  level: WarningLevel;
  containerId?: ContainerId;
}

export interface VisualEffectEvent {
  type: "visual-effect";
  kind: "route-flash" | "boundary-glow" | "particle";
  warehouseId: WarehouseId;
  containerId?: ContainerId;
}

/** 仓库生命周期变更（Scheduler 在状态机迁移时触发；供附近成员通知） */
export interface LifecycleChangedEvent {
  type: "lifecycle-changed";
  warehouseId: WarehouseId;
  from: string;
  to: string;
}

/** 领域事件总线：core 发事件 → 适配层订阅（视觉反馈/统计联动/成员通知） */
export class EventBus {
  readonly itemRouted = new EventSignal<ItemRoutedEvent>();
  readonly containerChanged = new EventSignal<ContainerChangedEvent>();
  readonly indexUpdated = new EventSignal<IndexUpdatedEvent>();
  readonly statsChanged = new EventSignal<StatsChangedEvent>();
  readonly warning = new EventSignal<WarningEvent>();
  readonly visualEffect = new EventSignal<VisualEffectEvent>();
  readonly lifecycleChanged = new EventSignal<LifecycleChangedEvent>();
}