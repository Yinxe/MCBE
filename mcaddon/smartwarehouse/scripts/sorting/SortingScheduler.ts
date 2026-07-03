import { world, system } from "@minecraft/server";
import type { WarehouseArea, WarehouseId } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { SorterEngine } from "./SorterEngine";
import { Logger } from "../util/Logger";
import { isNearAreaXZ } from "../util/Vector";

const log = new Logger("SortingScheduler");

/**
 * 分拣调度器 —— 惰性生命周期管理。
 *
 * 不再为所有仓库预先创建 runInterval，而是通过一个全局的监控 tick
 * 按需激活/停用仓库：
 *
 * ┌─ 生命周期状态 ──────────────────────────────────────────┐
 * │                                                         │
 * │  停用（Inactive）── 玩家接近 ──→ 激活（Active）          │
 * │    ↑                          │                         │
 * │    └── 玩家离开 + 延迟 ───────┘                         │
 * │                                                         │
 * │  - 停用：无 interval、无运行时模型（内存回收）           │
 * │  - 激活：创建 interval + 运行时模型（按需构建）           │
 * │  - 延迟 40 tick（~2秒）防频繁启停                       │
 * └─────────────────────────────────────────────────────────┘
 *
 * 设计要点：
 * - 脚本启动时不创建任何 interval，仅启动监控
 * - 每 20 tick 扫描玩家位置，管理仓库激活/停用
 * - 无玩家在线时所有仓库自动停用
 * - 仓库禁用/删除时立即停用
 * - 处理速度变化时重启 interval（如果活跃）
 * - 容错：单个仓库的异常不影响其他仓库
 */
export class SortingScheduler {
  /** 仓库区域外扩格数，范围内有玩家才激活仓库 */
  private static readonly PROXIMITY_MARGIN = 8;
  /** 生命周期监控间隔（20 tick ≈ 1 秒） */
  private static readonly LIFECYCLE_INTERVAL = 20;
  /** 玩家离开后停用仓库的延迟 tick 数（40 tick ≈ 2 秒），防止频繁启停 */
  private static readonly DEACTIVATE_DELAY = 40;

  /** 活跃仓库 ID → system.runInterval 句柄 */
  private readonly handles = new Map<WarehouseId, number>();
  /** 仓库 ID → 最近一次有玩家附近的 tick */
  private readonly lastActiveTick = new Map<WarehouseId, number>();
  /** 生命周期监控 interval 句柄 */
  private monitorHandle: number | undefined;

  /** 玩家位置缓存（维度ID → 位置列表），每 tick 刷新 */
  private playerCache = new Map<string, { x: number; z: number }[]>();

  constructor(
    private readonly repository: WarehouseRepository,
    private readonly engine: SorterEngine
  ) {}

  // ─── 生命周期管理 ─────────────────────────────────────────────

  /**
   * 启动调度系统。
   *
   * 仅启动全局监控 tick，不创建任何仓库 interval。
   * 仓库会在玩家接近相应区域时惰性激活，玩家离开后自动停用。
   *
   * 幂等：重复调用安全，会先停止现有监控。
   */
  start(): void {
    this.stop();
    this.monitorHandle = system.runInterval(() => {
      this.lifecycleTick();
    }, SortingScheduler.LIFECYCLE_INTERVAL);
    log.info("仓库生命周期监控已启动（间隔=20 tick）");
  }

  /**
   * 停止所有调度活动：停止监控 + 停用所有仓库。
   * 幂等。
   */
  stop(): void {
    this.stopAll();
    if (this.monitorHandle !== undefined) {
      system.clearRun(this.monitorHandle);
      this.monitorHandle = undefined;
    }
    this.lastActiveTick.clear();
    log.info("仓库生命周期监控已停止");
  }

  /**
   * 获取当前正在调度的仓库数量（活跃仓库数）。
   */
  get activeCount(): number {
    return this.handles.size;
  }

  // ─── 生命周期 tick ──────────────────────────────────────────

  /**
   * 每 20 tick 执行一次：
   * 1. 刷新玩家位置缓存
   * 2. 无玩家在线 → 停用所有仓库，跳过后续
   * 3. 有玩家 → 遍历仓库，按需激活/停用
   */
  private lifecycleTick(): void {
    // ── 刷新玩家位置缓存 ──
    this.playerCache.clear();
    for (const player of world.getPlayers()) {
      const dim = player.dimension.id;
      const pos = player.location;
      let list = this.playerCache.get(dim);
      if (!list) {
        list = [];
        this.playerCache.set(dim, list);
      }
      list.push({ x: pos.x, z: pos.z });
    }

    // 无玩家在线 → 全部停用
    if (this.playerCache.size === 0) {
      for (const id of [...this.handles.keys()]) {
        this.deactivate(id);
      }
      return;
    }

    // ── 遍历仓库，管理生命周期 ──
    const warehouses = this.repository.loadAll();
    const now = system.currentTick;

    for (const w of warehouses) {
      if (!w.settings.enabled) {
        this.deactivate(w.id);
        this.lastActiveTick.delete(w.id);
        continue;
      }

      const nearPlayer = this.hasNearbyPlayer(w.dimensionId, w.area);

      if (nearPlayer) {
        // 有玩家附近 → 记录活跃时间，必要时惰性激活
        this.lastActiveTick.set(w.id, now);
        if (!this.handles.has(w.id)) {
          // 快照可能已过期，防御性验证仓库仍存在（防止删除→重新激活僵尸 interval）
          if (!this.repository.load(w.id)) continue;
          this.activate(w.id, w.settings.processingSpeed);
        }
      } else if (this.handles.has(w.id)) {
        // 无玩家附近 → 检查是否超过停用延迟
        const lastActive = this.lastActiveTick.get(w.id);
        if (lastActive !== undefined && now - lastActive > SortingScheduler.DEACTIVATE_DELAY) {
          this.deactivate(w.id);
        }
      }
    }
  }

  /**
   * 检查指定区域在当前玩家缓存中是否有玩家在附近。
   */
  private hasNearbyPlayer(dimensionId: string, area: WarehouseArea): boolean {
    const players = this.playerCache.get(dimensionId);
    if (!players) return false;
    return players.some((p) => isNearAreaXZ(p, area, SortingScheduler.PROXIMITY_MARGIN));
  }

  /**
   * 激活仓库：创建 runInterval + 写入活跃表。
   */
  private activate(id: WarehouseId, speed: number): void {
    // 确保没有重复的 handle
    this.stopOne(id);

    const handle = system.runInterval(() => {
      try {
        this.engine.processWarehouse(id);
      } catch (error) {
        log.error(`仓库 ${id} 调度出错: ${error}`);
      }
    }, speed);

    this.handles.set(id, handle);
    log.info(`仓库 ${id} 已惰性激活（间隔=${speed} tick）`);
  }

  /**
   * 停用仓库：停止 interval + 释放运行时模型 + 清理活跃记录。
   */
  private deactivate(id: WarehouseId): void {
    this.stopOne(id);
    this.lastActiveTick.delete(id);
    this.engine.releaseRuntime(id);
  }

  // ─── 单仓库操作 ─────────────────────────────────────────────

  /**
   * 停止单个仓库的调度 interval（不释放运行时模型）。
   */
  private stopOne(id: WarehouseId): void {
    const handle = this.handles.get(id);
    if (handle !== undefined) {
      system.clearRun(handle);
      this.handles.delete(id);
      log.info(`仓库 ${id} 调度已停止`);
    }
  }

  // ─── 外部刷新接口 ──────────────────────────────────────────

  /**
   * 刷新单个仓库的调度（速度/启用状态变化时调用）。
   *
   * - 仓库已删除 → 停用
   * - 仓库已禁用 → 停用
   * - 仓库活跃中 → 用新速度重启 interval
   * - 仓库不活跃 → 什么也不做，lifecycleTick 下次会以新配置激活
   *
   * @param id 仓库 ID
   */
  refreshOne(id: WarehouseId): void {
    const warehouse = this.repository.load(id);
    if (!warehouse) {
      this.deactivate(id);
      return;
    }

    if (!warehouse.settings.enabled) {
      this.deactivate(id);
      return;
    }

    // 如果正在活跃，用新速度重启
    if (this.handles.has(id)) {
      this.activate(id, warehouse.settings.processingSpeed);
    }
    // 如果不活跃，lifecycleTick 下次会以新速度激活
  }

  /**
   * 停用所有仓库（保留监控）。
   */
  stopAll(): void {
    for (const [id, handle] of this.handles) {
      system.clearRun(handle);
      this.engine.releaseRuntime(id);
    }
    this.handles.clear();
    this.lastActiveTick.clear();
    log.info("已停止所有仓库调度");
  }
}
