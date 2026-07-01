import { system } from "@minecraft/server";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { SorterEngine } from "./SorterEngine";
import { Logger } from "../util/Logger";

const log = new Logger("SortingScheduler");

/**
 * 基于游戏刻（Tick）的调度器，按轮询方式处理所有仓库的分拣任务。
 *
 * ### 调度策略
 *
 * - **固定间隔执行**：每 8 游戏刻（约 0.4 秒）触发一次 tick。
 * - **每轮有限处理**：每个 tick 最多处理 `maxWarehousesPerRun` 个仓库，
 *   防止单 tick 内负载过高导致游戏卡顿。
 * - **轮询游标**：通过 `warehouseCursor` 游标在各个仓库间均匀分配处理机会，
 *   避免某些仓库长期得不到分拣。
 *
 * ### 容错设计
 *
 * - `start()` 可重复调用，后续调用为空操作（幂等性）。
 * - `stop()` 也可重复调用，安全清理定时器。
 * - 单个仓库的处理异常会被 catch 并记录日志，不会影响其他仓库的分拣。
 *
 * ### 性能考量
 *
 * `maxWarehousesPerRun` 被限制在 [1, 16] 范围内。实际值通常在构造函数中传入，
 * 默认为 4。如果仓库数量非常多，可适当调大此值以加快分拣吞吐量，
 * 但要注意控制单 tick 的执行时间以免影响游戏帧率。
 */
export class SortingScheduler {
  /** 调度器是否正在运行 */
  private running = false;

  /** 由 `system.runInterval` 返回的定时器句柄，用于后续取消 */
  private tickHandle: number | undefined;

  /**
   * 轮询游标 —— 记录下一个要处理的仓库在仓库列表中的索引位置。
   * 每次 tick 处理完一个仓库后递增，配合取模运算实现轮询调度。
   */
  private warehouseCursor = 0;

  /** 每个 tick 最多处理的仓库数量 */
  readonly maxWarehousesPerRun: number;

  /**
   * @param repository - 仓库持久化存储仓库
   * @param engine - 分拣引擎实例
   * @param maxWarehousesPerRun - 每 tick 最多处理的仓库数，默认 4，范围限制为 [1, 16]
   */
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly engine: SorterEngine,
    maxWarehousesPerRun: number = 4
  ) {
    // 将输入值限制在 1~16 之间，防止过小（永远处理不完）或过大（单 tick 卡顿）
    this.maxWarehousesPerRun = Math.min(16, Math.max(1, Math.floor(maxWarehousesPerRun)));
  }

  // ─── 生命周期管理 ───────────────────────────────────────────────

  /**
   * 启动调度器，向游戏引擎注册周期性 tick 回调。
   *
   * **幂等性**：如果调度器已在运行，重复调用此方法不会重复注册定时器，
   * 仅记录一条提示日志后返回。
   *
   * 定时器间隔固定为 8 游戏刻（≈0.4 秒），每次 tick 触发 `this.tick()`。
   */
  start(): void {
    if (this.running) {
      log.info("调度器已在运行，忽略重复启动");
      return;
    }
    this.running = true;
    this.tickHandle = system.runInterval(() => this.tick(), 8);
    log.info(`分拣调度器已启动（间隔=8 刻，每轮最多=${this.maxWarehousesPerRun} 个仓库）`);
  }

  /**
   * 停止调度器，清理定时器句柄。
   *
   * **幂等性**：多次调用安全，若调度器未运行则直接返回。
   * 停止后可通过 `start()` 重新启动。
   */
  stop(): void {
    if (!this.running) return;
    if (this.tickHandle !== undefined) {
      system.clearRun(this.tickHandle);
      this.tickHandle = undefined;
    }
    this.running = false;
    log.info("分拣调度器已停止");
  }

  // ─── Tick 逻辑 ─────────────────────────────────────────────────

  /**
   * 每个调度间隔触发一次。执行流程：
   *
   * 1. 从仓库仓库获取所有仓库 ID 列表。
   * 2. 若没有仓库，直接返回。
   * 3. 计算本轮实际要处理的仓库数（取 `maxWarehousesPerRun` 与仓库总数的较小值）。
   * 4. 从当前轮询游标位置开始，依次处理 `count` 个仓库：
   *    - 通过游标取模定位仓库 ID。
   *    - 游标前进（`warehouseCursor++`），为下一轮做准备。
   *    - 调用 `engine.processWarehouse()` 处理该仓库。
   *    - 捕获并记录任何异常，确保单个仓库的故障不会阻断其他仓库。
   *
   * 这种设计保证了在仓库数量远大于 `maxWarehousesPerRun` 时，
   * 所有仓库都能公平地获得处理机会，不会出现某些仓库被饿死的情况。
   */
  private tick(): void {
    const index = this.repository.getIndex();
    const warehouses = index.warehouses;

    if (warehouses.length === 0) return;

    // 本轮要处理的仓库数量：不能超过配置上限，也不能超过实际仓库总数
    const count = Math.min(this.maxWarehousesPerRun, warehouses.length);

    for (let i = 0; i < count; i++) {
      // 通过取模实现轮询，当游标超过数组长度时自动回绕
      const warehouseId = warehouses[this.warehouseCursor % warehouses.length];
      this.warehouseCursor++;

      try {
        this.engine.processWarehouse(warehouseId);
      } catch (error) {
        log.error(`处理仓库 ${warehouseId} 时出错: ${error}`);
        // 继续处理下一个仓库 —— 单个仓库的故障不应阻止其他仓库的分拣
      }
    }
  }
}
