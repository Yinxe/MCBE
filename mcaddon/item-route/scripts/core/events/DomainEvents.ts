// ─── 领域事件类型与事件总线 ──────────────────────────────
// core 与 mc 之间的"失联通讯"。core 只负责触发（生产者在 core 内部），
// mc 适配层订阅（消费者），实现「core 无状态、适配层做副作用」的六边形边界。
//
// 各事件生产者/消费者（审查对照）：
//   · itemRouted    —— Router 路由成功后触发；McEventBridge 订阅 → 标记索引脏 + 统计失效
//   · inputBlocked  —— 输入容器物品无法路由时触发；NotifyRelay 订阅 → 防抖提醒附近成员
//   · containerChanged —— 容器内容/注册变化触发；索引/统计联动；
//     OrganizeService 整理后也逐容器触发（整理造成的索引重建对外信号）
//   · containerAdded/containerRemoved —— 容器 CRUD：mc 层注册/完全拆除处触发
//   · indexUpdated  —— 预留（当前未消费，为搜索/展示留口）
//   · statsChanged  —— 预留（统计联动）
//   · warning       —— StatsService.evaluateWarnings 触发；WarningRelay 订阅 → 播报附近玩家
//   · visualEffect  —— 装配层（命令/交互）触发；SortEffects/BoundaryDisplay 订阅 → 播放
// 关键约束：事件负载只用可序列化的 string/number，不携带 mc 对象——保证 core 纯净、
// 且事件可安全穿越适配层边界。
import { EventSignal } from "./EventSignal";
import type { ContainerId, ItemId, WarehouseId } from "../model/types";
import type { ContainerRole } from "../model/Container";

// ── 事件负载 ─────────────────────────────────────────────
export interface ItemRoutedEvent {
  type: "item-routed";
  warehouseId: WarehouseId;
  from: ContainerId;
  to: ContainerId;
  itemId: ItemId;
  amount: number;
  /** 路由追踪：本次命中的策略 key（single/multi/family/misc），供调试/通知/统计 */
  strategy: string;
}

/** 输入容器物品无法路由（被阻塞）——Scheduler.processOnce 路由失败时触发；通知层防抖提醒 */
export interface InputBlockedEvent {
  type: "input-blocked";
  warehouseId: WarehouseId;
  containerId: ContainerId;
  itemId: ItemId;
  amount: number;
}

export interface ContainerChangedEvent {
  type: "container-changed";
  warehouseId: WarehouseId;
  containerId: ContainerId;
}

/** 容器结构变更原因（供通知层区分合箱/拆箱/属性变更） */
export type ContainerRegistryChangeReason = "merge" | "split" | "property";

/**
 * 容器注册表（属性/结构）变更：角色/启用/优先级/几何/id 变化。
 * 与 containerChanged（**内容**变化：路由/整理/玩家手动改箱代理信号）严格分离——
 * 持久化层只订阅本事件写注册表，避免"每次投递内容变更也写注册表"。
 * `reason` 供通知层区分 合箱(merge)/拆箱降级(split)/属性变更(property，默认)。
 */
export interface ContainerRegistryChangedEvent {
  type: "container-registry-changed";
  warehouseId: WarehouseId;
  containerId: ContainerId;
  /** 重定 ID（双箱合并/半拆主坐标）时的旧 ID，供持久化层清旧键 */
  oldId?: ContainerId;
  /** 结构变更原因（通知层区分合并/拆半/属性；缺省视为 property） */
  reason?: ContainerRegistryChangeReason;
}

/** 容器扫描的可序列化摘要（路由成功后对目标容器扫描，或整理后触发） */
export interface ContainerScanSummary {
  capacity: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  byType: Record<ItemId, number>;
  /** 混乱度（Organizer 计算，0-1；自动整理判定用） */
  messiness?: number;
}

/** 容器扫描完成：携带摘要，统计/自动整理/预警监听做单容器增量（事件驱动、免重复扫描） */
export interface ContainerScannedEvent {
  type: "container-scanned";
  warehouseId: WarehouseId;
  containerId: ContainerId;
  scan: ContainerScanSummary;
}

/** 容器注册入仓（放置新容器/双箱合并重建后）；mc 层在注册点触发 */
export interface ContainerAddedEvent {
  type: "container-added";
  warehouseId: WarehouseId;
  containerId: ContainerId;
  role: ContainerRole;
}

/** 容器完全拆除移除（半拆主坐标迁移不触发，仅 containerChanged） */
export interface ContainerRemovedEvent {
  type: "container-removed";
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

/** 预警级别：warning=某容器容量超阈值（容器级）；full=全仓库（除 input）满（满仓） */
export type WarningLevel = "warning" | "full";

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

// ── 仓库 CRUD 领域事件（集成测试可订阅观察，mc 层也可据此联动） ──
// 事件只携带 id/name（低耦合：core 只发事实，mc 层按其持久化边界自行重建运行时对象，
// 不依赖 core 的内部对象引用——v1 把扫描/仓库/仓储全耦合进 createWarehouse，此处刻意解耦）。
export interface WarehouseCreatedEvent {
  type: "warehouse-created";
  warehouseId: WarehouseId;
  displayName: string;
}
export interface WarehouseDeletedEvent {
  type: "warehouse-deleted";
  warehouseId: WarehouseId;
}
export interface WarehouseRenamedEvent {
  type: "warehouse-renamed";
  warehouseId: WarehouseId;
  displayName: string;
}
export interface WarehouseAreaChangedEvent {
  type: "warehouse-area-changed";
  /** 新仓库 ID（resize 可能重算 ID） */
  warehouseId: WarehouseId;
  /** 仅当 resize 使仓库 ID 迁移时提供旧 ID（否则 undefined）；持久化层据此迁移按仓 id 的键 */
  oldId?: WarehouseId;
}
export interface OrganizeCompletedEvent {
  type: "organize-completed";
  warehouseId: WarehouseId;
  moves: number;
}

/** 容器补注册：某容器在加载时被跳过（区块未加载）——mc 层订阅后记入仓库的 pendingReloads，主循环按节律重试 */
export interface ContainerDeferredEvent {
  type: "container-deferred";
  warehouseId: WarehouseId;
  containerId: ContainerId;
}

/** 领域事件总线：core 发事件 → 适配层订阅（视觉反馈/统计联动/成员通知/集成测试观测） */
export class EventBus {
  readonly itemRouted = new EventSignal<ItemRoutedEvent>();
  readonly inputBlocked = new EventSignal<InputBlockedEvent>();
  readonly containerChanged = new EventSignal<ContainerChangedEvent>();
  readonly containerRegistryChanged = new EventSignal<ContainerRegistryChangedEvent>();
  readonly containerScanned = new EventSignal<ContainerScannedEvent>();
  readonly containerAdded = new EventSignal<ContainerAddedEvent>();
  readonly containerRemoved = new EventSignal<ContainerRemovedEvent>();
  readonly indexUpdated = new EventSignal<IndexUpdatedEvent>();
  readonly statsChanged = new EventSignal<StatsChangedEvent>();
  readonly warning = new EventSignal<WarningEvent>();
  readonly visualEffect = new EventSignal<VisualEffectEvent>();
  readonly lifecycleChanged = new EventSignal<LifecycleChangedEvent>();
  readonly warehouseCreated = new EventSignal<WarehouseCreatedEvent>();
  readonly warehouseDeleted = new EventSignal<WarehouseDeletedEvent>();
  readonly warehouseRenamed = new EventSignal<WarehouseRenamedEvent>();
  readonly warehouseAreaChanged = new EventSignal<WarehouseAreaChangedEvent>();
  readonly organizeCompleted = new EventSignal<OrganizeCompletedEvent>();
  readonly containerDeferred = new EventSignal<ContainerDeferredEvent>();
}
