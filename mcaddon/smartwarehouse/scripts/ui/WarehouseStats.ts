import { world, type Container } from "@minecraft/server";
import type { BlockLocation, ContainerId, ContainerRole, ContainerStats, StoredContainer, WarehouseData, WarehouseId } from "../types";
import { ROLE_LABELS } from "../types";
import { getContainerFromStored } from "../sorting/ContainerInventory";
import { WarehouseStatsStore } from "../storage/WarehouseStatsStore";
import { Table, Cell } from "./Table";

// ─── 持久化层 ──────────────────────────────────────────────────

const statsStore = new WarehouseStatsStore();

// ═══════════════════════════════════════════════════════════════════
// WarehouseStats —— 仓库存储统计（纯失效驱动缓存）
// ═══════════════════════════════════════════════════════════════════
//
// 缓存策略：
//   1. 初始化首次请求时做一次全仓扫描，结果缓存在内存 + DP
//   2. 分拣引擎每次写入容器后，立即调用 refreshContainerStats() 重算该容器并写 DP
//   3. 用户在容器设置页主动打开时，独立重算单个容器
//   4. 唯一的全仓扫描触发途径：仓库设置页的"刷新存储统计"按钮
//   5. 崩溃重启后，缓存的 stats 从 DP 加载，无需重新全仓扫描
//
// ═══════════════════════════════════════════════════════════════════

// ─── 常量 ───────────────────────────────────────────────────────

/** 容量预警阈值：已用槽位占比超过此值视为"容量告急" */
export const CAPACITY_WARNING_THRESHOLD = 0.9;

// ─── 运行时缓存 ──────────────────────────────────────────────────

/** 每个仓库 → { containerId → 统计 } 的缓存 */
const containerCache = new Map<WarehouseId, Map<ContainerId, ContainerStats>>();

/**
 * 直接将容器统计写入缓存 + DP。
 * 用于容器设置页等已有现场扫描数据的场景，避免重复扫描。
 */
export function setContainerStats(
  warehouseId: WarehouseId,
  containerId: ContainerId,
  stats: ContainerStats
): void {
  let whCache = containerCache.get(warehouseId);
  if (!whCache) {
    whCache = new Map();
    containerCache.set(warehouseId, whCache);
  }
  whCache.set(containerId, stats);
  statsStore.saveContainerStats(warehouseId, containerId, stats);
}

/**
 * 标记整个仓库的统计缓存失效（清空内存缓存 + DP）。
 * 这是唯一的"触发全仓扫描"方式——下次 getWarehouseStats 会全部重算。
 */
export function invalidateWarehouseStats(warehouseId: WarehouseId, containerIds?: ContainerId[]): void {
  containerCache.delete(warehouseId);
  if (containerIds) {
    statsStore.deleteAllWarehouseStats(warehouseId, containerIds);
  }
}

/**
 * 获取单个容器的缓存统计。
 * 优先读内存缓存，未命中则尝试从 DP 加载，都无则计算并持久化。
 */
function getOrComputeContainerStats(
  warehouse: WarehouseData,
  stored: StoredContainer
): ContainerStats | undefined {
  // 优先读内存缓存
  const cached = containerCache.get(warehouse.id)?.get(stored.id);
  if (cached) return cached;

  // 内存未命中 → 尝试从 DP 加载（崩溃重启后兜底）
  const persisted = statsStore.loadContainerStats(warehouse.id, stored.id);
  if (persisted) {
    let whCache = containerCache.get(warehouse.id);
    if (!whCache) {
      whCache = new Map();
      containerCache.set(warehouse.id, whCache);
    }
    whCache.set(stored.id, persisted);
    return persisted;
  }

  // 全无 → 现场计算并持久化
  const fresh = computeContainerStats(warehouse.dimensionId, stored);
  if (!fresh) return undefined;

  let whCache = containerCache.get(warehouse.id);
  if (!whCache) {
    whCache = new Map();
    containerCache.set(warehouse.id, whCache);
  }
  whCache.set(stored.id, fresh);
  statsStore.saveContainerStats(warehouse.id, stored.id, fresh);

  return fresh;
}

/**
 * 分拣写入后立即重算单个容器的统计并持久化。
 *
 * 由 SorterEngine 在每次成功写入容器后调用，确保 stats 紧跟上实际数据，
 * 避免删除 DP 与重算之间的窗口期。
 */
export function refreshContainerStats(
  warehouse: WarehouseData,
  stored: StoredContainer
): ContainerStats | undefined {
  const fresh = computeContainerStats(warehouse.dimensionId, stored);
  if (!fresh) return undefined;

  // 更新内存缓存 + 写穿透持久化
  let whCache = containerCache.get(warehouse.id);
  if (!whCache) {
    whCache = new Map();
    containerCache.set(warehouse.id, whCache);
  }
  whCache.set(stored.id, fresh);
  statsStore.saveContainerStats(warehouse.id, stored.id, fresh);
  return fresh;
}

// ─── 类型定义 ───────────────────────────────────────────────────

/** 按角色分组的容器统计 */
export interface RoleStats {
  containerCount: number;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  hasWarning: boolean;
}

/** 仓库级别的完整统计 */
export interface WarehouseStats {
  displayName: string;
  containerCount: number;
  totalSlots: number;
  usedSlots: number;
  usagePercent: number;
  totalItems: number;
  uniqueTypes: number;
  hasWarning: boolean;
  byRole: Partial<Record<ContainerRole, RoleStats>>;
  enabledFamiliesCount: number;
}

// ─── 计算函数 ───────────────────────────────────────────────────

function computeContainerStats(
  dimensionId: string,
  container: StoredContainer
): ContainerStats | undefined {
  try {
    const dimension = world.getDimension(dimensionId);
    const mcContainer = getContainerFromStored(dimension, container);
    if (!mcContainer) return undefined;

    const totalSlots = mcContainer.size;
    let usedSlots = 0;
    let totalItems = 0;
    const uniqueTypesSet = new Set<string>();

    for (let slot = 0; slot < totalSlots; slot++) {
      try {
        const stack = mcContainer.getItem(slot);
        if (stack) {
          usedSlots++;
          totalItems += stack.amount;
          uniqueTypesSet.add(stack.typeId);
        }
      } catch { /* 跳过 */ }
    }

    const blockType = getBlockTypeLabel(dimension, container.primaryLocation);
    const usage = totalSlots > 0 ? usedSlots / totalSlots : 0;

    return {
      containerId: container.id,
      blockType,
      role: container.role,
      totalSlots,
      usedSlots,
      totalItems,
      uniqueTypes: uniqueTypesSet.size,
      isWarning: usage >= CAPACITY_WARNING_THRESHOLD,
    };
  } catch {
    return undefined;
  }
}

// ─── 公开入口 ────────────────────────────────────────────────────

/**
 * 获取仓库级别的完整统计。
 *
 * 优先读缓存，被脏标记的容器增量重算。
 * 如缓存完全不存在（首次或调用过 invalidateWarehouseStats），触发全仓扫描。
 */
export function getWarehouseStats(warehouse: WarehouseData): WarehouseStats {
  const byRole: Partial<Record<ContainerRole, RoleStats>> = {};
  let totalSlots = 0;
  let usedSlots = 0;
  let totalItems = 0;
  let hasWarning = false;
  let containerCount = 0;

  for (const stored of Object.values(warehouse.containers)) {
    const stats = getOrComputeContainerStats(warehouse, stored);
    if (!stats) continue;
    containerCount++;

    totalSlots += stats.totalSlots;
    usedSlots += stats.usedSlots;
    totalItems += stats.totalItems;
    if (stats.isWarning) hasWarning = true;

    const existing = byRole[stats.role] ?? {
      containerCount: 0, totalSlots: 0, usedSlots: 0,
      totalItems: 0, uniqueTypes: 0, hasWarning: false,
    };
    existing.containerCount++;
    existing.totalSlots += stats.totalSlots;
    existing.usedSlots += stats.usedSlots;
    existing.totalItems += stats.totalItems;
    existing.uniqueTypes += stats.uniqueTypes;
    existing.hasWarning = existing.hasWarning || stats.isWarning;
    byRole[stats.role] = existing;
  }

  const approxUniqueTypes = Object.values(byRole).reduce((s, r) => s + r.uniqueTypes, 0);

  return {
    displayName: warehouse.displayName,
    containerCount,
    totalSlots,
    usedSlots,
    usagePercent: totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0,
    totalItems,
    uniqueTypes: approxUniqueTypes,
    hasWarning,
    byRole,
    enabledFamiliesCount: (warehouse.settings.enabledFamilies ?? []).length,
  };
}

// ─── 格式化函数 ─────────────────────────────────────────────────

/**
 * 将仓库统计格式化为表格式文本（用于 ModalForm label）。
 *
 *   仓库 : my_base                        ← 第一行中文定字体
 *   <>           TYPES  ITEMS    STORAGE
 *   Container(8) 52     4250223  135/384(0.35)  ⚠
 *   Bulk(1)      1      3000     10/54(0.19)
 *   Normal(5)    12     1200     80/216(0.37)
 *   Misc(1)      8      50       45/114(0.39)   ⚠
 *   Input(10)    0      0        0/20(0.00)
 *   Family:54
 */
export function formatWarehouseStats(stats: WarehouseStats): string {
  const uc = (p: number) => p >= 100 ? "§c" : p >= 80 ? "§e" : p >= 50 ? "§6" : "§a";
  const warnThreshold = CAPACITY_WARNING_THRESHOLD * 100;
  const tbl = new Table();

  // 表头
  tbl.header(Cell.left("<>"), Cell.right("TYPES"), Cell.right("ITEMS"), Cell.left("STORAGE"));

  // 汇总
  const totPct = stats.totalSlots > 0 ? Math.round((stats.usedSlots / stats.totalSlots) * 100) : 0;
  const totRatio = `(${(totPct / 100).toFixed(2)})`;
  const totWarn = stats.totalSlots > 0 && totPct >= warnThreshold ? ` §e⚠` : "";
  tbl.row(
    `§eContainer(${stats.containerCount})`,
    Cell.right(String(stats.uniqueTypes)),
    Cell.right(String(stats.totalItems)),
    Cell.left(`§e${stats.usedSlots}§7/§e${stats.totalSlots}§7${uc(totPct)}${totRatio}§7${totWarn}`)
  );

  // 各角色
  const defs: { r: ContainerRole; c: string; l: string }[] = [
    { r: "bulk", c: "§b", l: "Bulk" }, { r: "normal", c: "§a", l: "Normal" },
    { r: "misc", c: "§d", l: "Misc" }, { r: "input", c: "§6", l: "Input" },
  ];
  for (const { r, c, l } of defs) {
    const rs = stats.byRole[r];
    if (!rs) continue;
    const p = rs.totalSlots > 0 ? Math.round((rs.usedSlots / rs.totalSlots) * 100) : 0;
    const ratio = `(${(p / 100).toFixed(2)})`;
    const warn = rs.totalSlots > 0 && p >= warnThreshold ? ` ${c}⚠` : "";
    tbl.row(
      `${c}${l}(${rs.containerCount})`,
      Cell.right(String(rs.uniqueTypes)),
      Cell.right(String(rs.totalItems)),
      Cell.left(`${c}${rs.usedSlots}§7/${c}${rs.totalSlots}§7${uc(p)}${ratio}§7${warn}`)
    );
  }

  // margin=0 缩小列宽，gaps=[1,1,3] 增加 STORAGE 列前间距
  const lines = [`§7仓库 : ${stats.displayName}`, tbl.render(0, [1, 1, 3])];
  if (stats.enabledFamiliesCount > 0) lines.push(` §bFamily:${stats.enabledFamiliesCount}`);
  return lines.join("\n");
}

/**
 * 格式化容器容量信息（单行，用于容器设置页 label）。
 * 格式：容量: 29/54[30%]  1856 items  27 types
 * 容量 ≥ 阈值时附加 ⚠ 符号。
 */
export function formatContainerCapacityLine(
  usedSlots: number,
  totalSlots: number,
  totalItems: number,
  uniqueTypes: number
): string {
  const usage = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0;
  const usageColor = getUsageColor(usage);
  const warn = usage >= CAPACITY_WARNING_THRESHOLD * 100 ? ` ${usageColor}⚠` : "";
  return `§7容量: §f${usedSlots}§7/§f${totalSlots}§7[${usageColor}${usage}%§7]  §f${formatNumber(totalItems)}§7 items  §f${uniqueTypes}§7 types${warn}`;
}

// ─── 辅助函数 ────────────────────────────────────────────────────

/**
 * 检查容器是否处于容量告急状态。
 */
export function isContainerNearFull(container: Container): boolean {
  let usedSlots = 0;
  for (let slot = 0; slot < container.size; slot++) {
    try {
      if (container.getItem(slot)) usedSlots++;
    } catch { /* 跳过 */ }
  }
  return container.size > 0 && usedSlots / container.size >= CAPACITY_WARNING_THRESHOLD;
}

/**
 * 快速检查容器是否已满。
 */
export function isContainerFull(container: Container): boolean {
  return container.emptySlotsCount === 0;
}

function getBlockTypeLabel(dimension: import("@minecraft/server").Dimension, location: BlockLocation): string {
  try {
    const block = dimension.getBlock(location);
    if (block) return block.typeId.replace("minecraft:", "");
  } catch { /* 默认 */ }
  return "unknown";
}

function getUsageColor(percent: number): string {
  if (percent >= 100) return "§c";
  if (percent >= 80) return "§e";
  if (percent >= 50) return "§6";
  return "§a";
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
