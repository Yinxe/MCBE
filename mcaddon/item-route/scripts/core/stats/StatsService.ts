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
import type { StatsStore } from "../storage/Stores";
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
    if (cached) return cached;
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

  /**
   * 三级预警（带冷却，冷却内返回 []）：
   * yellow = 任一容器超阈值；red = 任一非 input 角色组全满；deep-red = 全仓（除 input）全满。
   */
  evaluateWarnings(warehouse: Warehouse): WarningLevel[] {
    const cd = this.cooldowns.get(warehouse.id) ?? 0;
    if (cd > 0) return [];
    const levels: WarningLevel[] = [];
    const roleFull: Record<string, boolean> = {};
    let nonInputCount = 0;
    let nonInputFull = 0;
    for (const container of warehouse.containers.values()) {
      if (container.role === "input") continue;
      nonInputCount++;
      const full = container.usedSlots > 0 && container.emptySlotsCount === 0;
      if (full) nonInputFull++;
      roleFull[container.role] = (roleFull[container.role] ?? true) && full;
      const cs = this.getContainerStats(warehouse, container);
      if (cs.isWarning) levels.push("yellow");
    }
    for (const [role, full] of Object.entries(roleFull)) {
      if (full) levels.push("red");
    }
    if (nonInputCount > 0 && nonInputFull === nonInputCount) levels.push("deep-red");
    if (levels.length > 0) {
      this.cooldowns.set(warehouse.id, this.warningCooldownTicks);
      for (const level of levels) {
        this.bus.warning.trigger({ type: "warning", warehouseId: warehouse.id, level });
      }
      return levels;
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