import { world, system, type Dimension, type Player } from "@minecraft/server";
import type { WarehouseId, WarehouseArea, DimensionId, WarehouseData } from "../types";
import { Logger } from "../util/Logger";
import { isNearAreaXZ } from "../util/Vector";
import type { ModConfigStore } from "../storage/ModConfigStore";

const log = new Logger("BoundaryDisplay");

/**
 * ============================================================================
 * BoundaryDisplay —— 仓库边界线框显示
 * ============================================================================
 *
 * 在仓库 12 条棱上喷洒原版 endrod 粒子，形成白色线框长方体。
 * 每条棱上粒子间距 0.6 格，相邻粒子形成连续线条。
 *
 * 显示条件（通过 start 启动的持久边界）：
 * 1. 仓库设置 showBoundary = true
 * 2. 附近（区域各轴外扩 8 格）有玩家
 * 3. 该玩家手持信物（通过 ModConfigStore 配置）
 *
 * 临时边界（showTemporarily）不需要信物，用于创建/调整后的视觉反馈。
 *
 * 不依赖任何自定义粒子资源，纯原版粒子。
 * ============================================================================
 */
export class BoundaryDisplay {
  private readonly handles = new Map<WarehouseId, number>();
  /** 临时显示的延迟停止句柄（10 秒超时） */
  private readonly tempHandles = new Map<WarehouseId, number>();

  private static readonly REFRESH_INTERVAL = 40; // 2 秒
  private static readonly TEMP_DURATION_TICKS = 200; // 10 秒（20 tick/秒）
  private static readonly STEP = 0.6; // 粒子间距
  /** 仓库区域外扩格数，范围内有玩家才显示边界 */
  private static readonly PROXIMITY_MARGIN = 8;

  /**
   * @param configStore - 模组配置仓储（用于获取当前信物 ID）
   */
  constructor(private readonly configStore: ModConfigStore) {}

  // ─── 生命周期 ───────────────────────────────────────────────────

  start(warehouseId: WarehouseId, area: WarehouseArea, dimensionId: DimensionId): void {
    this.stop(warehouseId);

    this.drawEdges(warehouseId, area, dimensionId);

    const handle = system.runInterval(() => {
      this.drawEdges(warehouseId, area, dimensionId);
    }, BoundaryDisplay.REFRESH_INTERVAL);

    this.handles.set(warehouseId, handle);
  }

  /**
   * 临时显示仓库边界线框，指定时间后自动关闭。
   * 用于创建/调整操作后的视觉确认反馈，不改变仓库的 showBoundary 永久设置。
   *
   * @param warehouseId  - 仓库 ID
   * @param area         - 仓库区域
   * @param dimensionId  - 维度 ID
   */
  showTemporarily(warehouseId: WarehouseId, area: WarehouseArea, dimensionId: DimensionId): void {
    this.stop(warehouseId);

    // 临时边界不需要信物，作为创建/调整后的视觉确认反馈
    this.drawEdges(warehouseId, area, dimensionId, false);

    const handle = system.runInterval(() => {
      this.drawEdges(warehouseId, area, dimensionId, false);
    }, BoundaryDisplay.REFRESH_INTERVAL);
    this.handles.set(warehouseId, handle);

    const timeoutHandle = system.runTimeout(() => {
      this.stop(warehouseId);
      this.tempHandles.delete(warehouseId);
    }, BoundaryDisplay.TEMP_DURATION_TICKS);
    this.tempHandles.set(warehouseId, timeoutHandle);
  }

  stop(warehouseId: WarehouseId): void {
    const handle = this.handles.get(warehouseId);
    if (handle !== undefined) {
      system.clearRun(handle);
      this.handles.delete(warehouseId);
    }
    const tempHandle = this.tempHandles.get(warehouseId);
    if (tempHandle !== undefined) {
      system.clearRun(tempHandle);
      this.tempHandles.delete(warehouseId);
    }
  }

  stopAll(): void {
    for (const handle of this.handles.values()) {
      system.clearRun(handle);
    }
    this.handles.clear();
    for (const handle of this.tempHandles.values()) {
      system.clearRun(handle);
    }
    this.tempHandles.clear();
    log.info("所有仓库边界显示已停止");
  }

  refresh(warehouseId: WarehouseId, area: WarehouseArea, dimensionId: DimensionId): void {
    this.stop(warehouseId);
    this.start(warehouseId, area, dimensionId);
  }

  get activeCount(): number {
    return this.handles.size;
  }

  // ─── 12 条棱 ──────────────────────────────────────────────────

  /** 玩家缓存 tick */
  private static PLAYER_CACHE_TICK = 20;
  private playerCache: { x: number; z: number; hasToken: boolean }[] = [];
  private playerCacheUpdatedAt = 0;

  /**
   * 绘制仓库边界粒子线框。
   *
   * @param warehouseId  仓库 ID
   * @param area         仓库区域
   * @param dimensionId  维度
   * @param requireHoe   是否要求附近玩家手持信物才绘制（持久边界=true，临时边界=false）
   */
  private drawEdges(
    warehouseId: WarehouseId,
    area: WarehouseArea,
    dimensionId: DimensionId,
    requireHoe = true
  ): void {
    try {
      const dimension = world.getDimension(dimensionId);
      const { min, max } = area;
      const step = BoundaryDisplay.STEP;

      // ── 区块加载检查 ──
      try {
        const testBlock = dimension.getBlock({ x: min.x, y: min.y, z: min.z });
        if (!testBlock) return;
        // 访问 permutation 确认区块真正加载
        const _ = testBlock.permutation;
      } catch { return; }

      // ── 玩家接近检查（每 20 tick 刷新缓存） ──
      const now = system.currentTick;
      if (now - this.playerCacheUpdatedAt > BoundaryDisplay.PLAYER_CACHE_TICK) {
        this.playerCacheUpdatedAt = now;
        this.playerCache = world.getPlayers()
          .filter(p => p.dimension.id === dimensionId)
          .map(p => ({
            x: p.location.x,
            z: p.location.z,
            hasToken: this.configStore.isToken(
              p.getComponent("inventory")?.container?.getItem(p.selectedSlotIndex)?.typeId
            ),
          }));
      }
      if (this.playerCache.length > 0) {
        const margin = BoundaryDisplay.PROXIMITY_MARGIN;
        const valid = this.playerCache.some((p) =>
          isNearAreaXZ(p, area, margin) && (!requireHoe || p.hasToken)
        );
        if (!valid) return;
      }

      // 8 个顶点（max+1 以确保线框包围整个区域，而非缩在里面）
      const corners = [
        { x: min.x, y: min.y, z: min.z },         // 0: 前下左
        { x: max.x + 1, y: min.y, z: min.z },     // 1: 前下右
        { x: max.x + 1, y: min.y, z: max.z + 1 }, // 2: 后下右
        { x: min.x, y: min.y, z: max.z + 1 },     // 3: 后下左
        { x: min.x, y: max.y + 1, z: min.z },     // 4: 前上左
        { x: max.x + 1, y: max.y + 1, z: min.z }, // 5: 前上右
        { x: max.x + 1, y: max.y + 1, z: max.z + 1 }, // 6: 后上右
        { x: min.x, y: max.y + 1, z: max.z + 1 }, // 7: 后上左
      ];

      // 12 条棱（顶点索引对）
      const edges: [number, number][] = [
        // 底面 4 条
        [0, 1], [1, 2], [2, 3], [3, 0],
        // 顶面 4 条
        [4, 5], [5, 6], [6, 7], [7, 4],
        // 竖直 4 条
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];

      for (const [a, b] of edges) {
        this.drawLine(dimension, corners[a], corners[b], step);
      }

    } catch (error) {
      log.error(`仓库 ${warehouseId} 边界显示失败: ${error}`);
    }
  }

  /** 在两点之间喷洒粒子形成线段 */
  private drawLine(
    dimension: Dimension,
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    step: number
  ): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const count = Math.ceil(len / step);

    for (let i = 0; i <= count; i++) {
      const t = count > 0 ? i / count : 0;
      dimension.spawnParticle("minecraft:endrod", {
        x: from.x + dx * t,
        y: from.y + dy * t,
        z: from.z + dz * t,
      });
    }
  }
}
