import { world } from "@minecraft/server";
import type { WarehouseArea } from "../types";
import { isNearAreaXZ } from "../util/Vector";

/**
 * 玩家临近检测器 —— 缓存当前在线玩家的位置，提供临近仓库区域的查询能力。
 *
 * 从 SortingScheduler 中提取，职责纯粹：
 * - 缓存玩家位置（每 tick 刷新）
 * - 检测某区域附近是否有玩家（hasPlayerNearby）
 * - 查找区域内的第一个玩家 ID（findVisitor）
 *
 * 生命周期由调用方（SortingScheduler.lifecycleTick）控制。
 */
export class PlayerProximityTracker {
  /** 维度 ID → 玩家位置列表（含玩家 ID，用于 Visitor 跟踪） */
  private cache = new Map<string, Array<{ x: number; z: number; id: string }>>();

  /**
   * 从世界在线玩家中刷新缓存。
   * 每次调用完全重建缓存，不增量更新（玩家列表通常很小 < 20）。
   */
  refresh(): void {
    this.cache.clear();
    for (const player of world.getPlayers()) {
      const dim = player.dimension.id;
      let list = this.cache.get(dim);
      if (!list) {
        list = [];
        this.cache.set(dim, list);
      }
      list.push({ x: player.location.x, z: player.location.z, id: player.id });
    }
  }

  /** 是否有任意玩家在仓库区域的 margin 格内 */
  hasPlayerNearby(dimensionId: string, area: WarehouseArea, margin: number): boolean {
    const players = this.cache.get(dimensionId);
    if (!players) return false;
    return players.some((p) => isNearAreaXZ(p, area, margin));
  }

  /**
   * 查找仓库区域 margin 格内的第一个在线玩家 ID。
   * 用于停用仓库时向最后一个在场玩家发送通知。
   */
  findVisitor(dimensionId: string, area: WarehouseArea, margin: number): string | undefined {
    const players = this.cache.get(dimensionId);
    if (!players) return undefined;
    return players.find((p) => isNearAreaXZ(p, area, margin))?.id;
  }

  /** 无任何在线玩家 → true */
  get isEmpty(): boolean {
    return this.cache.size === 0;
  }
}
