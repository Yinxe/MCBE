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
  factory: McContainerFactory;
  /** 单容器写穿（注册表 + 索引条目；oldId=重定 ID 清旧键） */
  persistContainer: (warehouse: Warehouse, container: Container, oldId?: ContainerId) => void;
  /** 移除容器：清注册表 + 索引条目 + 统计键 */
  removeContainer: (warehouse: Warehouse, containerId: ContainerId) => void;
  /** 同步该仓容器 ID 索引 */
  persistContainerIds: (warehouse: Warehouse) => void;
  /** 扫描补注册持久化（只写新增容器 + 一次索引同步） */
  persistScannedContainers: (warehouse: Warehouse, added: Container[]) => void;
  /** 单仓最大容器数（建仓扫描校验；来自模组配置） */
  getMaxContainers: () => number;
}

/**
 * 注册全部领域事件订阅（单一入口）。处理器全部具名闭包、按关注点分组，
 * 订阅顺序即执行顺序（EventSignal 快照遍历，订阅者异常隔离）。
 */
export function registerSubscriptions(ctx: SubscriptionContext): void {
  const { bus, loaded, stats, organizer, organize, scheduler, warehouseStore, factory } = ctx;
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
    // ③ 索引纯运行时：路由成功不落盘（activate 全量重建），内存 byItem 桶由 onItemMoved 即时更新
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
      const res = organize.organizeContainer(wh, c, new MoveJournal());
      // ⚠️ 触发容器整理后 **重扫并更新该容器统计**（item：满仓误报修复）：
      // 整理腾出空槽后，统计缓存仍是整理前（满）的 usedSlots——后续预警/展示读到过期"满"。
      // 用整理后的真实内容重算槽位占用，让预警/统计看到空余空间（updateFromSummary 覆盖缓存）。
      if (res.ok) {
        const after = scanContainer(c);
        stats.updateFromSummary(
          c,
          {
            capacity: c.capacity,
            usedSlots: after.usedSlots,
            totalItems: after.totalItems,
            uniqueTypes: Object.keys(after.byType).length,
            byType: after.byType,
            messiness: organizer.messinessFromScan(after).total,
          },
          wh.settings.warningThreshold
        );
      }
    }
  });
  // 容量预警：目标容器容量变化 → 容器级预警（只查目标，O(1)；冷却抑制重复）
  bus.containerScanned.subscribe((e) => {
    const wh = resolveWh(e.warehouseId);
    if (wh !== undefined) stats.evaluateWarnings(wh, e.containerId);
  });
  // 输入堵塞 → 也评估预警：仓库满仓时路由失败（无 containerScanned），只有此事件可触发
  // warning/full 预警（item 10.1：满仓不再只表现为"输入被阻塞"）。无 containerId = 全仓判定。
  bus.inputBlocked.subscribe((e) => {
    const wh = resolveWh(e.warehouseId);
    if (wh !== undefined) stats.evaluateWarnings(wh);
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
    for (const cid of cids) stats.discard(cid);
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
      scanWarehouseArea(
        dim,
        wh.area,
        factory,
        scheduler.getIndex(wh.id),
        wh,
        ctx.getMaxContainers(),
        ctx.persistScannedContainers
      );
    }
  });
  // resize 区域变更 → **容器/索引/统计全部失效并重扫新区域**（item 9.6）：
  //   重新选区后区域内容器集合会变（新增/移除出范围），必须以新区域为真相源重建。
  //   做法：清内存容器表 + 输入镜像 + 统计缓存，删每容器注册表/索引键（按 cids），
  //   再 scanWarehouseArea 按新区域重注册（持久化新增 + 重建索引条目）。
  //   ⚠️ 顺序关键：warehouseAreaChanged 在旧 meta 移除**前**触发（WarehouseService 已重排），
  //   此处读到的是旧 cids 索引（需先枚举再删）。ID 未变时（e.oldId===warehouseId）同样失效重扫。
  bus.warehouseAreaChanged.subscribe((e) => {
    const wh = loaded.find((w) => w.id === e.warehouseId);
    if (wh === undefined) return;
    const index = scheduler.getIndex(wh.id);
    // 1) 枚举旧容器（cids 权威；ID 迁移时 cids 索引仍在旧 id 键下）→ 清内存/索引/统计/注册表键
    const cidsSource = e.oldId !== undefined && e.oldId !== e.warehouseId ? e.oldId : wh.id;
    const oldCids = warehouseStore.loadContainerIds(cidsSource) ?? [...wh.containers.keys()];
    for (const cid of oldCids) {
      const c = wh.containers.get(cid);
      if (c !== undefined) index?.onContainerRemoved(c);
      stats.discard(cid);
      warehouseStore.removeContainer(cid);
    }
    wh.containers.clear();
    wh.inputs.clear();
    if (e.oldId !== undefined && e.oldId !== e.warehouseId) {
      // 仓库 ID 迁移：清旧 cids 索引键 + 调度器重注册（内存对象 id 已更新）
      warehouseStore.removeContainerIds(e.oldId);
      scheduler.unregisterWarehouse(e.oldId);
      scheduler.registerWarehouse(wh);
    }
    // 2) 按新区域重扫 → 重新注册容器 + 重建索引条目 + 持久化（含 cids 索引）
    const dim = world.getDimension(wh.area.dimension);
    if (dim !== undefined) {
      scanWarehouseArea(dim, wh.area, factory, index, wh, ctx.getMaxContainers(), ctx.persistScannedContainers);
    }
  });
}
