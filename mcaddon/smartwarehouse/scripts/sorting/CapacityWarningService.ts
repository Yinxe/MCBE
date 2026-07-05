import { world, system } from "@minecraft/server";
import type { ContainerRole, ContainerStats, StoredContainer, WarehouseData } from "../types";
import { ROLE_LABELS } from "../types";
import { getChineseName } from "../data/ItemNameMap";
import { isNearAreaXZ } from "../util/Vector";

/** 冷却 tick 数（5 秒 = 100 tick） */
const COOLDOWN_TICKS = 100;

/**
 * 容量预警服务 —— 三级预警系统。
 *
 * 黄色：单箱容量超过阈值，提示具体容器。
 * 红色：某类容器组（normal/bulk/misc）全部已满，物品降级。
 * 深红：所有容器组全满，物品无法分拣。
 *
 * 黄色受容器级开关 capacityWarningEnabled 控制，
 * 红色/深红受仓库级开关 capacityWarning 控制。
 */
export class CapacityWarningService {
  private readonly cooldowns = new Map<string, number>();

  private canSend(key: string): boolean {
    const last = this.cooldowns.get(key) ?? 0;
    if (system.currentTick - last < COOLDOWN_TICKS) return false;
    this.cooldowns.set(key, system.currentTick);
    return true;
  }

  /** 黄色：单箱阈值预警 */
  checkContainer(warehouse: WarehouseData, containerId: string, stored: StoredContainer, stats: ContainerStats): void {
    if (!warehouse.settings.capacityWarning) return;
    if (!stored.capacityWarningEnabled) return;
    if (!stats.isWarning) return;

    if (!this.canSend(containerId)) return;
    const roleLabel = ROLE_LABELS[stored.role];
    const pct = stats.totalSlots > 0 ? Math.round((stats.usedSlots / stats.totalSlots) * 100) : 0;
    this.sendMessage(
      warehouse,
      `§e${roleLabel} ${containerId.slice(-8)} §7容量 §f${stats.usedSlots}§7/§f${stats.totalSlots}§7(§e${pct}%§7)`
    );
  }

  /** 红色：候选容器全满，物品降级 */
  warnDowngrade(warehouse: WarehouseData, from: ContainerRole, to: ContainerRole, typeId: string): void {
    if (!warehouse.settings.capacityWarning) return;
    if (!this.canSend(`downgrade:${warehouse.id}`)) return;
    const itemName = getChineseName(typeId);
    this.sendMessage(warehouse, `§c${ROLE_LABELS[from]}已满，${itemName} §7(${typeId})§c 降级至${ROLE_LABELS[to]}`);
  }

  /** 深红：全仓满 */
  warnWarehouseFull(warehouse: WarehouseData, typeId: string): void {
    if (!warehouse.settings.capacityWarning) return;
    if (!this.canSend(`full:${warehouse.id}`)) return;
    const itemName = getChineseName(typeId);
    this.sendMessage(warehouse, `§4仓库 ${warehouse.displayName} 已满，${itemName} §7(${typeId})§4 无法分拣`);
  }

  private sendMessage(warehouse: WarehouseData, message: string): void {
    try {
      for (const player of world.getPlayers()) {
        if (player.dimension.id !== warehouse.dimensionId) continue;
        if (isNearAreaXZ({ x: player.location.x, z: player.location.z }, warehouse.area, 8)) {
          try {
            player.sendMessage(`§l[预警]§r ${message}`);
          } catch {
            /* 忽略 */
          }
        }
      }
    } catch {
      /* 忽略 */
    }
  }
}
