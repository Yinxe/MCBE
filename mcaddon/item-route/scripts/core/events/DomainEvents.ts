// ─── 领域事件类型与事件总线 ──────────────────────────────
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

/** 领域事件总线：core 发事件 → 适配层订阅（视觉反馈/统计联动） */
export class EventBus {
  readonly itemRouted = new EventSignal<ItemRoutedEvent>();
  readonly containerChanged = new EventSignal<ContainerChangedEvent>();
  readonly indexUpdated = new EventSignal<IndexUpdatedEvent>();
  readonly statsChanged = new EventSignal<StatsChangedEvent>();
  readonly warning = new EventSignal<WarningEvent>();
  readonly visualEffect = new EventSignal<VisualEffectEvent>();
}