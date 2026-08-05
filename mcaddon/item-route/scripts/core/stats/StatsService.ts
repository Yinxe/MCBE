// ─── 统计系统：容器/仓库统计 + 三级预警（冷却） ────────────
// 两职责：
//   1. 统计聚合（getContainerStats/getWarehouseStats）——按类型/按物品双视图，
//      供 StatsUI 展示；容器级结果带内存缓存（invalidate 失效）。
//   2. 三级容量预警（evaluateWarnings）——yellow：任一容器占用 ≥ warningThreshold；
//      red：某非 input 角色组全满；deep-red：全仓（除 input）全满。
//      触发后置冷却（warningCooldownTicks），冷却内不再发，避免刷屏。
// ⚠️ 冷却递减由谁驱动（审查）：
//   装配层必须定期调 `tick()`（mc 层主循环已接线，见 McEventBridge）递减冷却，
//   否则预警只触发一次、永不复发。
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId, WarehouseId } from "../model/types";
import { scanContainer, type ContainerScanResult } from "../model/ContainerScan";
import type { StatsStore, StatsSnapshotData } from "../storage/Stores";
import type { EventBus, WarningLevel } from "../events/DomainEvents";

export interface ContainerStats {
  containerId: ContainerId;
  role: Container["role"];
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  isWarning: boolean;
  byType: Record<ItemId, number>;
}

export interface RoleStats {
  containerCount: number;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
}

export interface ItemStat {
  count: number;
  stacks: number;
  containerIds: ContainerId[];
}

export interface WarehouseStats {
  warehouseId: WarehouseId;
  containerCount: number;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  byRole: Record<string, RoleStats>;
  byType: Record<ItemId, number>;
  byItem: Record<ItemId, ItemStat>;
}

export class StatsService {
  private cache = new Map<ContainerId, ContainerStats>();
  private cooldowns = new Map<WarehouseId, number>();

  constructor(
    private readonly store: StatsStore,
    private readonly bus: EventBus,
    private readonly warningCooldownTicks = 100
  ) {}

  /** 容器内容变化后失效缓存 */
  invalidate(containerId: ContainerId): void {
    this.cache.delete(containerId);
  }

  getContainerStats(warehouse: Warehouse, container: Container): ContainerStats {
    const cached = this.cache.get(container.id);
    if (cached) {
      // 阈值可能已变：isWarning 实时按当前 warningThreshold 重算（usedSlots 已缓存，零扫描），
      // 并回写缓存本体，使 persistWarehouse 落盘快照带实时阈值
      const isWarning = container.capacity > 0 && cached.usedSlots / container.capacity >= warehouse.settings.warningThreshold;
      if (cached.isWarning !== isWarning) cached.isWarning = isWarning;
      return cached;
    }
    return this.buildStats(container, scanContainer(container), warehouse.settings.warningThreshold);
  }

  /**
   * 用外部提供的扫描结果直接维护缓存（免二次扫描）。
   * 配合路由成功后混乱度检查的同一趟 scanContainer 扫描，趁机增量维护容器统计。
   */
  updateFromScan(container: Container, scan: ContainerScanResult, warningThreshold: number): ContainerStats {
    return this.buildStats(container, scan, warningThreshold);
  }

  /** 由扫描结果构造并缓存容器统计 */
  private buildStats(container: Container, scan: ContainerScanResult, warningThreshold: number): ContainerStats {
    const byType = scan.byType;
    const usedSlots = scan.usedSlots;
    const totalItems = scan.totalItems;
    const uniqueTypes = Object.keys(byType).length;
    const stats: ContainerStats = {
      containerId: container.id,
      role: container.role,
      totalSlots: container.capacity,
      usedSlots,
      totalItems,
      uniqueTypes,
      isWarning: container.capacity > 0 && usedSlots / container.capacity >= warningThreshold,
      byType,
    };
    this.cache.set(container.id, stats);
    return stats;
  }

  getWarehouseStats(warehouse: Warehouse): WarehouseStats {
    const byRole: Record<string, RoleStats> = {};
    const byType: Record<ItemId, number> = {};
    const byItem: Record<ItemId, ItemStat> = {};
    let containerCount = 0;
    let totalSlots = 0;
    let usedSlots = 0;
    let totalItems = 0;
    for (const container of warehouse.containers.values()) {
      containerCount++;
      const cs = this.getContainerStats(warehouse, container);
      totalSlots += cs.totalSlots;
      usedSlots += cs.usedSlots;
      totalItems += cs.totalItems;
      const role = byRole[cs.role] ?? { containerCount: 0, totalSlots: 0, usedSlots: 0, totalItems: 0 };
      role.containerCount++;
      role.totalSlots += cs.totalSlots;
      role.usedSlots += cs.usedSlots;
      role.totalItems += cs.totalItems;
      byRole[cs.role] = role;
      for (const [itemId, count] of Object.entries(cs.byType)) {
        byType[itemId] = (byType[itemId] ?? 0) + count;
        const itemStat = byItem[itemId] ?? { count: 0, stacks: 0, containerIds: [] };
        itemStat.count += count;
        itemStat.stacks++;
        if (!itemStat.containerIds.includes(container.id)) itemStat.containerIds.push(container.id);
        byItem[itemId] = itemStat;
      }
    }
    // 持久化（写穿透）：统计在"查看汇总"时落盘。路由热路径的容器统计更新
    // （updateFromScan / 冷计算）仅驻内存，因统计是活容器内容的派生，读取仍需实时
    // 重算；落盘的是经过查看/计算的最新快照，作为持久记录供未来 warm-load 或还原。
    this.persistWarehouse(warehouse);
    return {
      warehouseId: warehouse.id,
      containerCount,
      totalSlots,
      usedSlots,
      totalItems,
      uniqueTypes: Object.keys(byType).length,
      byRole,
      byType,
      byItem,
    };
  }

  /** 写穿透整仓容器统计快照（每仓库一条 DP key，覆盖写） */
  private persistWarehouse(warehouse: Warehouse): void {
    const snap: StatsSnapshotData = { warehouseId: warehouse.id, containers: {} };
    for (const container of warehouse.containers.values()) {
      const stat = this.cache.get(container.id);
      if (stat !== undefined) snap.containers[container.id] = stat;
    }
    this.store.save(warehouse.id, snap);
  }

  /**
   * 容器级容量预警（带仓库级冷却，冷却内返回 []，避免每路由刷屏）。
   * 只报"某容器超阈值"（yellow，携带最满容器 id 供玩家定位），**不做角色组/全仓级**红深红。
   * - 路由热路径：`evaluateWarnings(wh, targetContainerId)` —— 只查目标容器，O(1) 无全仓扫描
   * - 手动/全览：不传 containerId → 遍历容器取最满超阈值者报一次
   */
  evaluateWarnings(warehouse: Warehouse, containerId?: ContainerId): WarningLevel[] {
    const cd = this.cooldowns.get(warehouse.id) ?? 0;
    if (cd > 0) return [];
    const targets = (
      containerId !== undefined
        ? [warehouse.containers.get(containerId)]
        : [...warehouse.containers.values()]
    ).filter((c): c is Container => c !== undefined && c.role !== "input");
    let yellowId: ContainerId | undefined;
    let worstRatio = -1;
    for (const container of targets) {
      const cs = this.getContainerStats(warehouse, container);
      if (!cs.isWarning) continue;
      const ratio = cs.totalSlots > 0 ? cs.usedSlots / cs.totalSlots : 0;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        yellowId = cs.containerId;
      }
    }
    if (yellowId !== undefined) {
      this.cooldowns.set(warehouse.id, this.warningCooldownTicks);
      this.bus.warning.trigger({ type: "warning", warehouseId: warehouse.id, level: "yellow", containerId: yellowId });
      return ["yellow"];
    }
    return [];
  }

  /** 冷却递减（由 Scheduler.tick 调用） */
  tick(): void {
    for (const [id, cd] of this.cooldowns) {
      if (cd <= 1) this.cooldowns.delete(id);
      else this.cooldowns.set(id, cd - 1);
    }
  }
}