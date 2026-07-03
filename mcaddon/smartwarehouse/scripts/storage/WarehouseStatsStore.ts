import type { ContainerId, ContainerStats, WarehouseId } from "../types";
import { DynamicPropertyStore } from "./DynamicPropertyStore";

/**
 * ============================================================================
 * WarehouseStatsStore —— 容器统计持久化层（Dynamic Property 单容器分片存储）
 * ============================================================================
 *
 * 每个容器的统计作为一条独立 Dynamic Property 存储，键格式：
 *   sw:warehouse:<warehouseId>:cstats:<containerId>
 *
 * 读写时机：
 * - 计算完毕 → 立即写穿透（refreshContainerStats 或 getOrComputeContainerStats 触发）
 * - 仓库设置页点"刷新" → invalidateWarehouseStats 删除该仓库所有统计的 DP 条目
 * - 首次加载（无缓存、无 DP 条目）→ 全仓扫描计算后写入
 * - 崩溃重启 → 缺失的 DP 条目会在下次访问时自动重算
 * ============================================================================
 */

/** Dynamic Property 键前缀 */
const STATS_PREFIX = "sw:warehouse:";

/** 构造单个容器统计的 Dynamic Property 键名 */
function statsKey(warehouseId: WarehouseId, containerId: ContainerId): string {
  return `${STATS_PREFIX}${warehouseId}:cstats:${containerId}`;
}

/**
 * 容器统计持久化仓储。
 * 使用 DynamicPropertyStore 读写，每条 DP 存储一个容器的 ContainerStats。
 */
export class WarehouseStatsStore {
  /**
   * @param store 底层动态属性存储实例，默认新建
   */
  constructor(private readonly store = new DynamicPropertyStore()) {}

  /**
   * 从持久化存储中加载单个容器的统计。
   * @param warehouseId  - 仓库 ID
   * @param containerId  - 容器 ID
   * @returns 若存在则返回 ContainerStats，否则返回 undefined
   */
  loadContainerStats(warehouseId: WarehouseId, containerId: ContainerId): ContainerStats | undefined {
    const key = statsKey(warehouseId, containerId);
    return this.store.getJson<ContainerStats | undefined>(key, undefined);
  }

  /**
   * 从持久化存储中批量加载指定仓库的所有容器统计。
   * 只返回在 DP 中存在的统计，不存在的容器不会出现在结果中。
   *
   * @param warehouseId  - 仓库 ID
   * @param containerIds - 该仓库所有容器的 ID 列表
   * @returns containerId → ContainerStats 的映射
   */
  loadAllContainerStats(
    warehouseId: WarehouseId,
    containerIds: ContainerId[]
  ): Map<ContainerId, ContainerStats> {
    const result = new Map<ContainerId, ContainerStats>();
    for (const cid of containerIds) {
      const stat = this.loadContainerStats(warehouseId, cid);
      if (stat) result.set(cid, stat);
    }
    return result;
  }

  /**
   * 保存单个容器的统计到持久化存储（写穿透）。
   * @param warehouseId  - 仓库 ID
   * @param containerId  - 容器 ID
   * @param stats        - 容器统计对象
   */
  saveContainerStats(warehouseId: WarehouseId, containerId: ContainerId, stats: ContainerStats): void {
    const key = statsKey(warehouseId, containerId);
    this.store.setJson(key, stats);
  }

  /**
   * 删除单个容器的统计持久化条目。
   * 在 invalidateContainerStats 时调用。
   */
  deleteContainerStats(warehouseId: WarehouseId, containerId: ContainerId): void {
    const key = statsKey(warehouseId, containerId);
    this.store.delete(key);
  }

  /**
   * 删除指定仓库的所有容器统计持久化条目。
   * 在 invalidateWarehouseStats 时调用。
   *
   * @param warehouseId  - 仓库 ID
   * @param containerIds - 该仓库所有容器的 ID 列表
   */
  deleteAllWarehouseStats(warehouseId: WarehouseId, containerIds: ContainerId[]): void {
    for (const cid of containerIds) {
      this.deleteContainerStats(warehouseId, cid);
    }
  }
}
