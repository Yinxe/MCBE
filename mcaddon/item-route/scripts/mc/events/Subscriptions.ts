// ─── 中央事件订阅注册：领域事件订阅统一集中管理 ─────────────
// 所有 EventBus 领域事件（持久化 / 路由副作用 / 仓库生命周期）的订阅都在这里，
// 按关注点分组、处理器具名，形成单一审计点（hot = 每路由/每容器扫描触发，cold = 低频 CRUD）。
// main.ts 组合根只负责构造 ctx + 调 registerSubscriptions；事件 → 持久化的解耦逻辑全部在此。
// 世界事件（playerPlaceBlock 等）由 McEventBridge 负责；视觉/通知类 effect 各自 registerX，
// 但领域事件的消费者统一收编于此。
import { world } from "@minecraft/server";
import type { EventBus } from "../../core/events/DomainEvents";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import type { ContainerId } from "../../core/model/types";
import type { StatsService } from "../../core/stats/StatsService";
import type { Organizer } from "../../core/organizing/Organizer";
import type { OrganizeService } from "../../core/services/OrganizeService";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { McWarehouseStore } from "../storage/McWarehouseStore";
import type { McIndexStore } from "../storage/McIndexStore";
import type { McContainerFactory } from "../adapters/McContainerFactory";
import { scanContainer } from "../../core/model/ContainerScan";
import { scanWarehouseArea } from "../commands/scan";
import { MoveJournal } from "../../core/routing/Move";

/** 订阅上下文：main.ts 组合根构造注入（持久化助手 + 服务 + 运行时仓库表） */
export interface SubscriptionContext {
  bus: EventBus;
  /** 当前已加载仓库（Phase 4 填充；新建/删除实时更新） */
  loaded: Warehouse[];
  stats: StatsService;
  organizer: Organizer;
  organize: OrganizeService;
  scheduler: Scheduler;
  warehouseStore: McWarehouseStore;
  indexStore: McIndexStore;
  factory: McContainerFactory;
  /** 单容器写穿（注册表 + 索引条目；oldId=重定 ID 清旧键） */
  persistContainer: (warehouse: Warehouse, container: Container, oldId?: ContainerId) => void;
  /** 移除容器：清注册表 + 索引条目 + 统计键 */
  removeContainer: (warehouse: Warehouse, containerId: ContainerId) => void;
  /** 同步该仓容器 ID 索引 */
  persistContainerIds: (warehouse: Warehouse) => void;
  /** 扫描补注册持久化（只写新增容器 + 一次索引同步） */
  persistScannedContainers: (warehouse: Warehouse, added: Container[]) => void;
}

/**
 * 注册全部领域事件订阅（单一入口）。处理器全部具名闭包、按关注点分组，
 * 订阅顺序即执行顺序（EventSignal 快照遍历，订阅者异常隔离）。
 */
export function registerSubscriptions(ctx: SubscriptionContext): void {
  const { bus, loaded, stats, organizer, organize, scheduler, warehouseStore, indexStore, factory } = ctx;
  const resolveWh = (id: string): Warehouse | undefined => loaded.find((w) => w.id === id);

  // ── 路由副作用（hot）：itemRouted → 扫描目标 → containerScanned ──
  bus.itemRouted.subscribe((e) => {
    // ① 源容器内容流出 → 失效其缓存（目标由 containerScanned 重算写穿）
    stats.invalidate(e.from);
    // ② 扫描目标容器 → 发 containerScanned（携带可序列化摘要 + 混乱度）
    const wh = resolveWh(e.warehouseId);
    const target = wh?.containers.get(e.to);
    if (wh === undefined || target === undefined) return;
    const scan = scanContainer(target);
    bus.containerScanned.trigger({
      type: "container-scanned",
      warehouseId: e.warehouseId,
      containerId: e.to,
      scan: {
        capacity: target.capacity,
        usedSlots: scan.usedSlots,
        totalItems: scan.totalItems,
        uniqueTypes: Object.keys(scan.byType).length,
        byType: scan.byType,
        messiness: organizer.messinessFromScan(scan).total,
      },
    });
  });
  // 统计：单容器增量 + 立即写穿该容器自己的键（事件驱动最小单位，无定时 flush）
  bus.containerScanned.subscribe((e) => {
    const wh = resolveWh(e.warehouseId);
    const c = wh?.containers.get(e.containerId);
    if (wh === undefined || c === undefined) return;
    stats.updateFromSummary(c, e.scan, wh.settings.warningThreshold);
  });
  // 自动整理：目标混乱度超阈值 → 单容器就地整理（v1 onDeposit 语义）
  bus.containerScanned.subscribe((e) => {
    const wh = resolveWh(e.warehouseId);
    if (wh === undefined || !wh.settings.sortingEnabled || e.scan.messiness === undefined) return;
    const c = wh.containers.get(e.containerId);
    if (c === undefined) return;
    if (e.scan.messiness > wh.settings.autoSortThreshold) {
      organize.organizeContainer(wh, c, new MoveJournal());
      stats.invalidate(c.id); // 整理改变了目标内容
    }
  });
  // 容量预警：目标容器容量变化 → 容器级预警（只查目标，O(1)；冷却抑制重复）
  bus.containerScanned.subscribe((e) => {
    const wh = resolveWh(e.warehouseId);
    if (wh !== undefined) stats.evaluateWarnings(wh, e.containerId);
  });
  // 路由成功视觉反馈：目标容器闪光
  bus.itemRouted.subscribe((e) => {
    bus.visualEffect.trigger({
      type: "visual-effect",
      kind: "route-flash",
      warehouseId: e.warehouseId,
      containerId: e.to,
    });
  });

  // ── 容器结构/属性变更 → 逐容器持久化（cold；替代命令式 onContainerRegistered 钩子） ──
  bus.containerRegistryChanged.subscribe((e) => {
    const wh = resolveWh(e.warehouseId);
    const c = wh?.containers.get(e.containerId);
    if (wh === undefined || c === undefined) return;
    ctx.persistContainer(wh, c, e.oldId);
    ctx.persistContainerIds(wh);
  });
  bus.containerAdded.subscribe((e) => {
    const wh = resolveWh(e.warehouseId);
    const c = wh?.containers.get(e.containerId);
    if (wh === undefined || c === undefined) return;
    ctx.persistContainer(wh, c);
    ctx.persistContainerIds(wh);
  });
  bus.containerRemoved.subscribe((e) => {
    const wh = resolveWh(e.warehouseId);
    if (wh === undefined) return;
    ctx.removeContainer(wh, e.containerId);
    ctx.persistContainerIds(wh);
  });

  // ── 仓库生命周期（cold） ──
  // 删除：清内存 + 停调度 + 清索引条目/统计键（注册表键由 core deleteWarehouse 的 store.remove 清理）。
  // 容器可能**未加载**（启动不预载）→ 用 cids 索引枚举清键，而非依赖 warehouse.containers。
  bus.warehouseDeleted.subscribe((e) => {
    const i = loaded.findIndex((w) => w.id === e.warehouseId);
    if (i >= 0) loaded.splice(i, 1);
    scheduler.unregisterWarehouse(e.warehouseId); // 停 interval + indexLifecycle.unload（若已加载则逐容器落盘）
    const cids = warehouseStore.loadContainerIds(e.warehouseId) ?? [];
    for (const cid of cids) {
      indexStore.removeContainer(cid);
      stats.discard(cid);
    }
  });
  // 创建：纳入 loaded + 注册调度 + 立即扫描区域容器（mc 按自身持久化边界重建运行时对象，低耦合）
  bus.warehouseCreated.subscribe((e) => {
    const snapshot = warehouseStore.load(e.warehouseId);
    if (snapshot === undefined) return; // 已删除/未落盘：忽略
    const wh: Warehouse = {
      id: snapshot.id,
      displayName: snapshot.displayName,
      ownerName: snapshot.ownerName,
      members: snapshot.members,
      area: snapshot.area,
      settings: snapshot.settings,
      containers: new Map<string, Container>(),
      inputs: new Map<string, Container>(),
    };
    loaded.push(wh);
    scheduler.registerWarehouse(wh);
    const dim = world.getDimension(wh.area.dimension);
    if (dim !== undefined) {
      scanWarehouseArea(dim, wh.area, factory, scheduler.getIndex(wh.id), wh, ctx.persistScannedContainers);
    }
  });
  // resize 使仓库 ID 迁移 → 迁移按仓 id 存储的键（cids 索引）+ 调度器重注册（替代构造回调 onRebase）
  bus.warehouseAreaChanged.subscribe((e) => {
    if (e.oldId === undefined || e.oldId === e.warehouseId) return; // 非迁移（区域变但 ID 不变）
    const cids = warehouseStore.loadContainerIds(e.oldId);
    if (cids !== undefined) {
      warehouseStore.saveContainerIds(e.warehouseId, cids);
      warehouseStore.removeContainerIds(e.oldId);
    }
    scheduler.unregisterWarehouse(e.oldId);
    const wh = loaded.find((w) => w.id === e.warehouseId);
    if (wh !== undefined) scheduler.registerWarehouse(wh);
  });
}
