import { Dimension, Container } from "@minecraft/server";
import type { ContainerId, WarehouseData, WarehouseRuntimeModel } from "../types";
import { getContainerFromStored, containerHasType, isContainerEmpty, getFamilyPurity } from "./ContainerInventory";
import { getFamilyById } from "../data/ItemFamilies";

// ═══════════════════════════════════════════════════════════════════
// 物品类型索引（itemTypeIndex）管理 —— 自愈机制
// ═══════════════════════════════════════════════════════════════════
//
// itemTypeIndex 是一个运行时缓存，记录"物品类型 → 包含该物品的普通容器列表"。
// 由于容器内的物品可能被玩家取走或被破坏，索引可能"脏"（stale）。
// 本模块采用惰性校验 + 自动修复策略，无需实时监听事件。
// ═══════════════════════════════════════════════════════════════════

/**
 * 查找当前仓库中已包含指定物品类型的普通容器。
 *
 * 有索引时走快速路径（仅校验候选列表），无索引时全量扫描所有 normal 容器。
 * 校验过程中发现的脏数据会被惰性清除；全量扫描的结果会写回索引。
 *
 * @returns 当前实际包含该物品类型的普通容器 ID 列表
 */
export function findExistingTypeContainers(
  warehouse: WarehouseData,
  model: WarehouseRuntimeModel,
  typeId: string,
  dimension: Dimension
): ContainerId[] {
  const hasIndexEntry = model.itemTypeIndex.has(typeId);

  // ── 阶段 1：校验候选容器 ─────────────────────────────────
  const candidates = hasIndexEntry
    ? model.itemTypeIndex.get(typeId)!
    : model.normalContainerIds;
  const { valid, stale } = validateTypeIndexCandidates(
    hasIndexEntry, candidates, warehouse, model, typeId, dimension
  );

  // ── 阶段 2：惰性清除脏索引 ───────────────────────────────
  if (hasIndexEntry && stale.size > 0) {
    cleanStaleTypeIndexEntries(model, typeId, stale);
  }

  // ── 阶段 3：索引全脏后的零延迟回退 ──────────────────────
  // 场景：玩家把圆石从 normal 箱 A 移到 normal 箱 B。
  //       索引指向 A（{"cobblestone":["A"]}），但 A 已无圆石。
  //       阶段 1 会清空索引条目，valid 为空。
  //       此时物品会错误地落入杂项箱。
  // 修复：立即全量扫描，零回合延迟。
  if (hasIndexEntry && stale.size > 0 && valid.length === 0) {
    fullScanNormalContainers(warehouse, model, typeId, dimension, valid);
  }

  // ── 阶段 4：学习新发现的容器到索引 ───────────────────────
  if (!hasIndexEntry && valid.length > 0) {
    model.itemTypeIndex.set(typeId, [...valid]);
  }

  return valid;
}

/**
 * 校验候选容器列表中哪些仍然有效，哪些已过时。
 */
function validateTypeIndexCandidates(
  hasIndexEntry: boolean,
  candidates: ContainerId[],
  warehouse: WarehouseData,
  model: WarehouseRuntimeModel,
  typeId: string,
  dimension: Dimension
): { valid: ContainerId[]; stale: Set<ContainerId> } {
  const valid: ContainerId[] = [];
  const stale = new Set<ContainerId>();

  for (const containerId of candidates) {
    const stored = warehouse.containers[containerId];
    if (!stored || stored.role !== "normal" || !stored.enabled) {
      if (hasIndexEntry) stale.add(containerId);
      continue;
    }

    const container = getContainerFromStored(dimension, stored);
    if (!container) {
      // 容器不可达 → 索引路径下保留在索引但本次跳过
      if (hasIndexEntry) valid.push(containerId);
      continue;
    }

    if (isContainerEmpty(container)) {
      if (hasIndexEntry) stale.add(containerId);
      continue;
    }

    if (containerHasType(container, typeId)) {
      valid.push(containerId);
    } else if (hasIndexEntry) {
      stale.add(containerId);
    }
  }

  return { valid, stale };
}

/**
 * 从索引中惰性清除脏条目。
 * 如果某类型下所有容器都脏了，删除整个条目。
 */
function cleanStaleTypeIndexEntries(
  model: WarehouseRuntimeModel, typeId: string, stale: Set<ContainerId>
): void {
  const candidates = model.itemTypeIndex.get(typeId);
  if (!candidates) return;

  const updated = candidates.filter((id) => !stale.has(id));
  if (updated.length > 0) {
    model.itemTypeIndex.set(typeId, updated);
  } else {
    model.itemTypeIndex.delete(typeId);
  }
}

/**
 * 全量扫描所有 normal 容器，查找包含指定物品类型的容器。
 * 结果写入 valid 数组和索引。
 */
function fullScanNormalContainers(
  warehouse: WarehouseData,
  model: WarehouseRuntimeModel,
  typeId: string,
  dimension: Dimension,
  result: ContainerId[]
): void {
  for (const containerId of model.normalContainerIds) {
    if (result.includes(containerId)) continue;
    const stored = warehouse.containers[containerId];
    if (!stored || stored.role !== "normal" || !stored.enabled) continue;
    const container = getContainerFromStored(dimension, stored);
    if (!container) continue;
    if (isContainerEmpty(container)) continue;
    if (containerHasType(container, typeId)) {
      result.push(containerId);
    }
  }

  if (result.length > 0) {
    model.itemTypeIndex.set(typeId, [...result]);
  }
}

/**
 * 将容器 ID 记录到运行时物品类型索引中，避免重复添加。
 */
export function addToTypeIndex(
  model: WarehouseRuntimeModel, typeId: string, containerId: ContainerId
): void {
  const existing = model.itemTypeIndex.get(typeId);
  if (existing) {
    if (!existing.includes(containerId)) {
      existing.push(containerId);
    }
  } else {
    model.itemTypeIndex.set(typeId, [containerId]);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 同族分类索引（familyTypeIndex）管理
// ═══════════════════════════════════════════════════════════════════

/**
 * 查找已包含指定同族物品的普通容器。
 *
 * 当物品属于某个已启用的同族分类时，根据 familyTypeIndex 查找已有同类族物品的容器，
 * 使得同族物品（如各色羊毛）能够自动聚集到同一容器中。
 *
 * @returns 按家族纯度降序排列的候选容器 ID 列表
 */
export function findExistingFamilyContainers(
  warehouse: WarehouseData,
  model: WarehouseRuntimeModel,
  familyId: string,
  dimension: Dimension
): ContainerId[] {
  const family = getFamilyById(familyId);
  if (!family) return [];

  const memberSet = new Set(family.items);
  const candidates = model.familyTypeIndex.get(familyId);
  const hasIndex = candidates !== undefined && candidates.length > 0;

  const valid: ContainerId[] = [];
  const stale = new Set<ContainerId>();
  const containerCache = new Map<ContainerId, Container>();

  // ── 有索引：检查索引项，标记过期 ──────────────
  if (hasIndex) {
    for (const containerId of candidates) {
      const stored = warehouse.containers[containerId];
      if (!stored || stored.role !== "normal" || !stored.enabled) {
        stale.add(containerId);
        continue;
      }

      const container = getContainerFromStored(dimension, stored);
      if (!container) {
        valid.push(containerId);
        continue;
      }

      const hasFamilyItem = family.items.some((typeId) => containerHasType(container, typeId));

      if (hasFamilyItem) {
        valid.push(containerId);
        containerCache.set(containerId, container);
      } else {
        stale.add(containerId);
      }
    }

    if (stale.size > 0) {
      const updated = candidates.filter((id) => !stale.has(id));
      if (updated.length > 0) {
        model.familyTypeIndex.set(familyId, updated);
      } else {
        model.familyTypeIndex.delete(familyId);
      }
    }
  }

  // ── 回退 / 初始全量扫描 ─────────────────────────
  const needsFullScan = !hasIndex || (valid.length === 0 && stale.size > 0);
  if (!needsFullScan) {
    return sortByFamilyPurity(valid, memberSet, containerCache);
  }

  for (const containerId of model.normalContainerIds) {
    if (hasIndex && candidates.includes(containerId)) continue;
    const stored = warehouse.containers[containerId];
    if (!stored || stored.role !== "normal" || !stored.enabled) continue;
    const container = getContainerFromStored(dimension, stored);
    if (!container) continue;
    if (family.items.some((typeId) => containerHasType(container, typeId))) {
      valid.push(containerId);
      containerCache.set(containerId, container);
    }
  }

  if (valid.length > 0) {
    model.familyTypeIndex.set(familyId, [...valid]);
  }

  return sortByFamilyPurity(valid, memberSet, containerCache);
}

/**
 * 按家族纯度对候选容器列表降序排序。
 *
 * 纯度越高的容器越优先接收物品，使得家族物品自然流入更"专一"的容器，
 * 避免已混杂多个家族的容器承受过大的物品压力。
 */
function sortByFamilyPurity(
  containerIds: ContainerId[],
  memberSet: Set<string>,
  containerCache: Map<ContainerId, Container>
): ContainerId[] {
  if (containerIds.length <= 1) return containerIds;

  const scored: { id: ContainerId; purity: number; index: number }[] = [];
  let hasPositivePurity = false;

  for (let i = 0; i < containerIds.length; i++) {
    const containerId = containerIds[i];
    const container = containerCache.get(containerId);
    if (!container) {
      scored.push({ id: containerId, purity: 0, index: i });
      continue;
    }
    const purity = getFamilyPurity(container, memberSet);
    if (purity > 0) hasPositivePurity = true;
    scored.push({ id: containerId, purity, index: i });
  }

  if (!hasPositivePurity) return containerIds;

  scored.sort((a, b) => b.purity - a.purity || a.index - b.index);
  return scored.map((s) => s.id);
}

/**
 * 将容器 ID 记录到运行时同族分类索引中。
 */
export function addToFamilyIndex(
  model: WarehouseRuntimeModel, familyId: string, containerId: ContainerId
): void {
  const existing = model.familyTypeIndex.get(familyId);
  if (existing) {
    if (!existing.includes(containerId)) {
      existing.push(containerId);
    }
  } else {
    model.familyTypeIndex.set(familyId, [containerId]);
  }
}
