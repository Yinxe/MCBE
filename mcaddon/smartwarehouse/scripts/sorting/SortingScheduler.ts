import { system } from "@minecraft/server";
import type { WarehouseId } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { SorterEngine } from "./SorterEngine";
import { Logger } from "../util/Logger";

const log = new Logger("SortingScheduler");

/**
 * 分拣调度器 —— 每个已启用的仓库拥有独立的 system.runInterval。
 *
 * 设计要点：
 * - interval 间隔 = warehouse.settings.processingSpeed（4/8/16/20 tick）
 * - 仓库禁用 → 停止 interval；启用 → 创建 interval
 * - 处理速度变化 → 停止旧的 + 创建新的
 * - 仓库删除 → 清理 interval
 *
 * 容错：每个仓库的处理在 processWarehouse 内部已有 try-catch，
 * 单个仓库异常不影响其他仓库。
 */
export class SortingScheduler {
  /** 仓库 ID → system.runInterval 句柄 */
  private readonly handles = new Map<WarehouseId, number>();

  constructor(
    private readonly repository: WarehouseRepository,
    private readonly engine: SorterEngine
  ) {}

  // ─── 全局生命周期 ───────────────────────────────────────────────

  /**
   * 为所有已启用的仓库启动独立调度 interval。
   * 在脚本启动时调用一次。
   * 幂等：重复调用前会先 stopAll。
   */
  startAll(): void {
    this.stopAll();
    const warehouses = this.repository.loadAll();
    for (const w of warehouses) {
      if (w.settings.enabled) {
        this.startOne(w.id, w.settings.processingSpeed);
      }
    }
    log.info(`已启动 ${this.handles.size} 个仓库的独立调度`);
  }

  /**
   * 停止所有仓库的调度 interval。
   */
  stopAll(): void {
    for (const [id, handle] of this.handles) {
      system.clearRun(handle);
    }
    this.handles.clear();
    log.info("已停止所有仓库调度");
  }

  // ─── 单仓库操作 ─────────────────────────────────────────────────

  /**
   * 启动单个仓库的调度 interval。
   * @param id 仓库 ID
   * @param speed 处理速度（tick 间隔）
   */
  startOne(id: WarehouseId, speed: number): void {
    // 先清理可能已存在的旧 handle
    this.stopOne(id);

    const handle = system.runInterval(() => {
      try {
        this.engine.processWarehouse(id);
      } catch (error) {
        log.error(`仓库 ${id} 调度出错: ${error}`);
      }
    }, speed);

    this.handles.set(id, handle);
    log.info(`仓库 ${id} 调度已启动（间隔=${speed} tick）`);
  }

  /**
   * 停止单个仓库的调度 interval。
   * @param id 仓库 ID
   */
  stopOne(id: WarehouseId): void {
    const handle = this.handles.get(id);
    if (handle !== undefined) {
      system.clearRun(handle);
      this.handles.delete(id);
      log.info(`仓库 ${id} 调度已停止`);
    }
  }

  /**
   * 刷新单个仓库的调度（速度/启用状态变化时调用）。
   * 如果仓库已启用 → 用新速度重启 interval
   * 如果仓库已禁用 → 停止 interval
   * @param id 仓库 ID
   */
  refreshOne(id: WarehouseId): void {
    const warehouse = this.repository.load(id);
    if (!warehouse) {
      this.stopOne(id);
      return;
    }

    if (warehouse.settings.enabled) {
      this.startOne(id, warehouse.settings.processingSpeed);
    } else {
      this.stopOne(id);
    }
  }

  /** 获取当前正在调度的仓库数量 */
  get activeCount(): number {
    return this.handles.size;
  }
}
