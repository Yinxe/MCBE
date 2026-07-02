/**
 * ============================================================================
 * SearchService —— 仓库容器搜索服务
 * ============================================================================
 *
 * 职责：
 * 1. 在指定仓库的所有容器中搜索匹配物品（按物品名/ID/中文名模糊匹配）
 * 2. 返回每个容器的匹配结果（物品类型 + 数量 + 位置）
 * 3. 结果按容器位置排序
 *
 * 匹配策略：
 * - 委托 ItemNameMap.searchItems() 进行 typeId 和中文名的模糊匹配
 * - 直接扫描容器库存，获取实时数量
 *
 * 设计原则：
 * - 每个仓库搜索独立（为未来多玩家扩展做准备）
 * - 所有容器访问使用 try-catch 保护（遵循现有模式）
 * - 不修改任何数据，只读操作
 * ============================================================================
 */

import { Dimension, type Container, type ItemStack } from "@minecraft/server";
import type { ContainerId, StoredContainer, WarehouseData, WarehouseId } from "../types";
import { getContainerFromStored } from "../sorting/ContainerInventory";
import { searchItems, getChineseName } from "../data/ItemNameMap";
import { Logger } from "../util/Logger";

const log = new Logger("SearchService");

// ─── 类型定义 ───────────────────────────────────────────────────

/**
 * 单个容器的搜索结果。
 */
export interface ContainerSearchResult {
  /** 容器 ID */
  containerId: ContainerId;
  /** 容器位置（主坐标） */
  location: { x: number; y: number; z: number };
  /** 容器所占用的所有方块位置（多格容器如大箱子有多个） */
  occupiedLocations: { x: number; y: number; z: number }[];
  /** 匹配到的物品列表 */
  items: MatchedItem[];
}

/**
 * 匹配到的物品信息。
 */
export interface MatchedItem {
  /** 物品类型 ID */
  typeId: string;
  /** 中文名（如果映射中存在） */
  displayName: string;
  /** 该容器中此物品的总数量 */
  totalCount: number;
}

/**
 * 仓库的完整搜索结果。
 */
export interface WarehouseSearchResult {
  /** 仓库 ID */
  warehouseId: WarehouseId;
  /** 仓库显示名称 */
  warehouseDisplayName: string;
  /** 维度 ID */
  dimensionId: string;
  /** 匹配到的容器 */
  containers: ContainerSearchResult[];
  /** 总匹配容器数 */
  containerCount: number;
  /** 总匹配物品类型数 */
  itemTypeCount: number;
}

// ─── 搜索服务 ───────────────────────────────────────────────────

/**
 * 仓库容器搜索服务。
 * 在指定仓库中搜索匹配物品，返回详细结果。
 */
export class SearchService {
  // ─── 公开方法 ─────────────────────────────────────────────────

  /**
   * 在指定仓库中搜索匹配查询的物品。
   *
   * @param warehouse - 要搜索的仓库数据
   * @param query     - 搜索查询
   * @param dimension - 维度对象（用于访问容器）
   * @returns 仓库的搜索结果
   */
  search(warehouse: WarehouseData, query: string, dimension: Dimension): WarehouseSearchResult {
    // 1. 先通过名称映射找出匹配的 typeId
    const matchedTypeIds = new Set(searchItems(query));

    const containers: ContainerSearchResult[] = [];

    for (const stored of Object.values(warehouse.containers)) {
      const result = this.searchContainer(stored, matchedTypeIds, dimension);
      if (result && result.items.length > 0) {
        containers.push(result);
      }
    }

    // 按容器位置排序
    containers.sort((a, b) => {
      if (a.location.x !== b.location.x) return a.location.x - b.location.x;
      if (a.location.z !== b.location.z) return a.location.z - b.location.z;
      return a.location.y - b.location.y;
    });

    const itemTypeCount = new Set<string>();
    for (const c of containers) {
      for (const item of c.items) {
        itemTypeCount.add(item.typeId);
      }
    }

    return {
      warehouseId: warehouse.id,
      warehouseDisplayName: warehouse.displayName,
      dimensionId: warehouse.dimensionId,
      containers,
      containerCount: containers.length,
      itemTypeCount: itemTypeCount.size,
    };
  }

  /**
   * 对搜索结果中的匹配容器坐标去重，返回所有被占用方块位置。
   *
   * 多格容器（如大箱子）会标记所占用的所有格子，而不仅是主位置。
   *
   * @param result - 搜索结果
   * @returns 需要标记粒子的坐标列表
   */
  getMarkerLocations(result: WarehouseSearchResult): { x: number; y: number; z: number }[] {
    const seen = new Set<string>();
    const locations: { x: number; y: number; z: number }[] = [];

    for (const container of result.containers) {
      // 推送容器所占用的所有格子，而不是仅主位置
      const allPositions = container.occupiedLocations.length > 0
        ? container.occupiedLocations
        : [container.location];

      for (const pos of allPositions) {
        const key = `${pos.x}|${pos.y}|${pos.z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        locations.push(pos);
      }
    }

    return locations;
  }

  // ─── 私有方法 ─────────────────────────────────────────────────

  /**
   * 搜索单个容器中的匹配物品。
   */
  private searchContainer(
    stored: StoredContainer,
    matchedTypeIds: Set<string>,
    dimension: Dimension
  ): ContainerSearchResult | undefined {
    let container: Container | undefined;
    try {
      container = getContainerFromStored(dimension, stored);
    } catch {
      return undefined;
    }
    if (!container) return undefined;

    const found: MatchedItem[] = [];
    const seenTypes = new Set<string>();

    for (let slot = 0; slot < container.size; slot++) {
      let item: ItemStack | undefined;
      try {
        item = container.getItem(slot);
      } catch {
        continue; // 跳过不可访问的槽位
      }
      if (!item) continue;

      const typeId = item.typeId;
      if (!matchedTypeIds.has(typeId) && !seenTypes.has(typeId)) {
        // 当 matchedTypeIds 为空时（未匹配到任何 ID），尝试直接模糊匹配
        if (matchedTypeIds.size > 0) continue;
        // 如果 matchedTypeIds 为空（搜索词未匹配到已知物品），则跳过所有
        continue;
      }

      if (seenTypes.has(typeId)) {
        // 已有同类物品，累加数量
        const existing = found.find((f) => f.typeId === typeId);
        if (existing) {
          existing.totalCount += item.amount;
        }
        continue;
      }

      seenTypes.add(typeId);
      found.push({
        typeId,
        displayName: getChineseName(typeId),
        totalCount: item.amount,
      });
    }

    if (found.length === 0) return undefined;

    return {
      containerId: stored.id,
      location: stored.primaryLocation,
      occupiedLocations: stored.occupiedLocations,
      items: found,
    };
  }
}

/**
 * 格式化搜索结果为聊天消息文本。
 *
 * @param result - 搜索结果
 * @returns 格式化的多行文本
 */
export function formatSearchResult(result: WarehouseSearchResult): string[] {
  if (result.containerCount === 0) {
    return [`§7未找到匹配的物品。`];
  }

  const lines: string[] = [];

  // 标题
  lines.push(`§6=== ${result.warehouseDisplayName} 搜索结果 ===`);

  // 每个容器
  for (const container of result.containers) {
    const pos = container.location;
    const itemsStr = container.items
      .map((item) => `§a${item.displayName}§7×${item.totalCount}`)
      .join("  ");
    lines.push(`  §7[${pos.x},${pos.y},${pos.z}] ${itemsStr}`);
  }

  // 汇总
  lines.push(
    `§7共找到 §a${result.itemTypeCount}§7 种物品，位于 §a${result.containerCount}§7 个容器`
  );

  return lines;
}
