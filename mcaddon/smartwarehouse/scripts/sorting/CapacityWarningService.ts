import { world, system } from "@minecraft/server";
import type { ContainerId, ContainerStats, StoredContainer, WarehouseData } from "../types";
import { ROLE_LABELS } from "../types";
import { isNearAreaXZ } from "../util/Vector";

/** 容量预警冷却 tick 数（5 秒 = 100 tick，防止刷屏） */
const CAPACITY_WARNING_COOLDOWN_TICKS = 100;

/**
 * 容量预警服务 —— 检测容器是否接近满仓，向附近玩家发送预警消息。
 *
 * 从 SorterEngine 中提取，职责纯粹：
 * - 检查容量状态并决定是否预警
 * - 防刷（每个容器 5 秒冷却）
 * - 向区域内玩家发送消息
 *
 * 是纯副作用模块，不依赖分拣引擎的业务逻辑。
 */
export class CapacityWarningService {
  /** 容量预警冷却：容器 ID → 上次预警 tick */
  private readonly cooldowns = new Map<string, number>();

  /**
   * 检查容器是否接近满仓，如果是且预警开关已开则发送预警消息。
   *
   * @param stats - refreshContainerStats 返回的已计算统计（避免二次扫描）
   */
  checkAndWarn(warehouse: WarehouseData, containerId: string, stored: StoredContainer, stats: ContainerStats): void {
    if (!warehouse.settings.capacityWarning) return;
    if (!stored.capacityWarningEnabled) return;
    if (!stats.isWarning) return;

    const roleLabel = ROLE_LABELS[stored.role];
    const pct = stats.totalSlots > 0 ? Math.round((stats.usedSlots / stats.totalSlots) * 100) : 0;
    this.warn(
      warehouse,
      containerId,
      `§e${roleLabel}容器 ${containerId.slice(-8)} §7容量告急 §f${stats.usedSlots}§7/§f${stats.totalSlots}§7(§c${pct}%§7)`
    );
  }

  /**
   * 向仓库附近的玩家发送通用预警消息（如"容器已满，物品将转移"）。
   * 带冷却防刷。
   */
  warn(warehouse: WarehouseData, containerId: string, message: string): void {
    // 防刷：每个容器每 5 秒最多发一次预警
    const lastTick = this.cooldowns.get(containerId) ?? 0;
    if (system.currentTick - lastTick < CAPACITY_WARNING_COOLDOWN_TICKS) return;
    this.cooldowns.set(containerId, system.currentTick);

    try {
      for (const player of world.getPlayers()) {
        if (player.dimension.id !== warehouse.dimensionId) continue;
        if (isNearAreaXZ({ x: player.location.x, z: player.location.z }, warehouse.area, 8)) {
          try {
            player.sendMessage(`§c[容量预警]§r ${message}`);
          } catch {
            /* 玩家可能断线 */
          }
        }
      }
    } catch {
      /* world.getPlayers 可能抛出异常 */
    }
  }
}
