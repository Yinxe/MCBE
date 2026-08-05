// ─── 统计系统：容器/仓库统计 + 容量预警（两级，冷却） ────────
// 两职责：
//   1. 统计聚合（getContainerStats/getWarehouseStats）——按类型/按物品双视图，
//      供 StatsUI 展示；容器级结果带内存缓存（invalidate 失效）。
//   2. 容量预警（evaluateWarnings）——warning：某容器占用 ≥ warningThreshold（容器级）；
//      full：全仓库（除 input）满仓（仅目标容器满时 gated 全仓判定）。
//      触发后置冷却（warningCooldownTicks），冷却内不再发，避免刷屏。
// ⚠️ 冷却递减由谁驱动（审查）：
//   装配层必须定期调 `tick()`（mc 层主循环已接线，见 McEventBridge）递减冷却，
//   否则预警只触发一次、永不复发。
// ⚠️ 持久化（审查）：
//   统计是**活容器内容的派生**（权威源 = 游戏容器）。存储为**每容器一条键**（v1 方案）：
//   · 路由热路径 `updateFromScan` 仅驻内存 + 标记脏（零 DP 写）
//   · `flush()`（装配层 100 tick / 玩家离开）批量落盘脏容器
//   · 冷读 `getContainerStats` 先**懒加载持久化**（v1 getOrCompute 方案：有就 warm、结构不符/缺失才重算+写穿）；
//     内容陈旧（崩溃窗口）由后续路由/交互信号自愈，与索引惰性校验同思路。
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
  /** 统计已变、待批量落盘的容器（路由热路径增量，flush 时逐容器写穿） */
  private dirty = new Set<ContainerId>();

  constructor(
    private readonly store: StatsStore,
    private readonly bus: EventBus,
    private readonly warningCooldownTicks = 100
  ) {}

  /** 容器内容变化后失效缓存（仅内存；热路径安全——路由每轮 invalidate 不写 DP） */
  invalidate(containerId: ContainerId): void {
    this.cache.delete(containerId);
  }

  /** 容器移除时丢弃统计（内存 + 持久化键 + 脏标记）；结构变更路径（拆除/重定/删仓）用 */
  discard(containerId: ContainerId): void {
    this.cache.delete(containerId);
    this.dirty.delete(containerId);
    this.store.removeContainer(containerId);
  }

  getContainerStats(warehouse: Warehouse, container: Container): ContainerStats {
    const cached = this.cache.get(container.id);
    if (cached) {
      // 阈值可能已变：isWarning 实时按当前 warningThreshold 重算（usedSlots 已缓存，零扫描），
      // 并回写缓存本体，使落盘快照带实时阈值
      const isWarning = container.capacity > 0 && cached.usedSlots / container.capacity >= warehouse.settings.warningThreshold;
      if (cached.isWarning !== isWarning) cached.isWarning = isWarning;
      return cached;
    }
    // 冷读：实时重算（不懒加载持久化——否则 invalidate 的"下次读重算"语义会被陈旧 warm 击败）
    return this.buildStats(container, scanContainer(container), warehouse.settings.warningThreshold, true);
  }

  /**
   * 仓库激活时加载持久化统计作 warm 缓存（与索引同生命周期点，见 indexLifecycle.load）。
   * 只在此刻加载一次；之后缓存由路由 updateFromScan / invalidate 维持，冷读仍实时重算。
   * 结构不符（角色/容量变）跳过该容器。内容陈旧（崩溃窗口）由后续变更信号自愈。
   */
  warm(warehouse: Warehouse): void {
    for (const container of warehouse.containers.values()) {
      if (this.cache.has(container.id)) continue;
      const loaded = this.store.loadContainer(container.id);
      if (loaded === undefined || loaded.totalSlots !== container.capacity || loaded.role !== container.role) continue;
      this.cache.set(container.id, {
        containerId: container.id,
        role: container.role,
        totalSlots: loaded.totalSlots,
        usedSlots: loaded.usedSlots,
        totalItems: loaded.totalItems,
        uniqueTypes: loaded.uniqueTypes,
        isWarning: false, // 阈值实时判，见 getContainerStats 缓存命中分支
        byType: loaded.byType,
      });
    }
  }

  /**
   * 用外部提供的扫描结果直接维护缓存（免二次扫描）。
   * 配合路由成功后混乱度检查的同一趟 scanContainer 扫描，趁机增量维护容器统计。
   * **仅驻内存**（路由热路径不写 DP，落盘由查看汇总/冷读写穿承担）。
   */
  updateFromScan(container: Container, scan: ContainerScanResult, warningThreshold: number): ContainerStats {
    return this.buildStats(container, scan, warningThreshold, false);
  }

  /** 由扫描结果构造并缓存容器统计；persist=true 时立即写穿单容器键（冷读），否则仅驻内存 + 标记脏待 flush */
  private buildStats(container: Container, scan: ContainerScanResult, warningThreshold: number, persist: boolean): ContainerStats {
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
    this.dirty.add(container.id); // 待 flush 落盘（路由增量）
    if (persist) this.store.saveContainer(container.id, stats); // 冷读立即写穿
    return stats;
  }

  /**
   * 批量落盘脏容器统计（路由热路径增量，由装配层每 100 tick / 玩家离开时调用）。
   * 失败项保留脏标记，下次 flush 自动重试；返回失败数。
   */
  flush(): number {
    let failed = 0;
    for (const id of [...this.dirty]) {
      const stat = this.cache.get(id);
      if (stat === undefined) {
        this.dirty.delete(id); // 缓存已失效 → 无可写，清脏标记
        continue;
      }
      if (this.store.saveContainer(id, stat)) {
        this.dirty.delete(id);
      } else {
        failed++;
      }
    }
    return failed;
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
    // 持久化（写穿透）：统计在"查看汇总"时逐容器落盘（每容器一条键）。
    // 路由热路径的容器统计增量（updateFromScan）仅驻内存；落盘的是经过查看/计算的最新快照，
    // 作为持久记录供未来 warm-load 或还原。
    this.persistAll(warehouse);
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

  /** 写穿透：查看汇总时把当前缓存逐容器落盘（每容器一条键）；路由热路径增量仅驻内存 */
  private persistAll(warehouse: Warehouse): void {
    for (const container of warehouse.containers.values()) {
      const stat = this.cache.get(container.id);
      if (stat !== undefined) this.store.saveContainer(container.id, stat);
    }
  }

/**
   * 容量预警（带仓库级冷却，冷却内返回 []，避免每路由刷屏）——两级：
   *   · warning：某容器容量超阈值（**容器级**，携带最满容器 id 供定位）
   *   · full   ：全仓库（除 input）**满仓**
   * - 路由热路径：`evaluateWarnings(wh, targetContainerId)` —— 警告只查目标 O(1)；
   *   满仓只在"目标容器已满"时才做全仓空仓判定（全仓只能因目标变满而变满，gated 全仓扫描 + 冷却限流）
   * - 手动/全览：不传 containerId → 遍历容器。
   */
  evaluateWarnings(warehouse: Warehouse, containerId?: ContainerId): WarningLevel[] {
    const cd = this.cooldowns.get(warehouse.id) ?? 0;
    if (cd > 0) return [];
    const targets = (
      containerId !== undefined
        ? [warehouse.containers.get(containerId)]
        : [...warehouse.containers.values()]
    ).filter((c): c is Container => c !== undefined && c.role !== "input");
    if (targets.length === 0) return [];

    // warning：最满的超阈值容器（容器级）
    let warnId: ContainerId | undefined;
    let worstRatio = -1;
    for (const container of targets) {
      const cs = this.getContainerStats(warehouse, container);
      if (!cs.isWarning) continue;
      const ratio = cs.totalSlots > 0 ? cs.usedSlots / cs.totalSlots : 0;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        warnId = cs.containerId;
      }
    }
    // full：仅当本轮涉及容器存在满仓才可能全仓满 → gated 全仓判定
    const hasFull = targets.some((c) => c.emptySlotsCount === 0);
    const full = hasFull && this.warehouseFullStocked(warehouse);

    if (warnId === undefined && !full) return [];
    this.cooldowns.set(warehouse.id, this.warningCooldownTicks);
    const emitted: WarningLevel[] = [];
    if (warnId !== undefined) {
      this.bus.warning.trigger({ type: "warning", warehouseId: warehouse.id, level: "warning", containerId: warnId });
      emitted.push("warning");
    }
    if (full) {
      this.bus.warning.trigger({ type: "warning", warehouseId: warehouse.id, level: "full" });
      emitted.push("full");
    }
    return emitted;
  }

  /** 全仓库（除 input）是否满仓（非空且所有非 input 容器 usedSlots>0 且无空槽） */
  private warehouseFullStocked(warehouse: Warehouse): boolean {
    let nonInputCount = 0;
    let nonInputFull = 0;
    for (const c of warehouse.containers.values()) {
      if (c.role === "input") continue;
      nonInputCount++;
      if (c.usedSlots > 0 && c.emptySlotsCount === 0) nonInputFull++;
    }
    return nonInputCount > 0 && nonInputFull === nonInputCount;
  }

  /** 冷却递减（由 Scheduler.tick 调用） */
  tick(): void {
    for (const [id, cd] of this.cooldowns) {
      if (cd <= 1) this.cooldowns.delete(id);
      else this.cooldowns.set(id, cd - 1);
    }
  }
}