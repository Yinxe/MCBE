// ─── 容量预警播报：bus.warning → 发给同维度 8 格内玩家（v1 沉淀） ──
import { world } from "@minecraft/server";
import type { EventBus, WarningEvent, WarningLevel } from "../../core/events/DomainEvents";
import type { Warehouse } from "../../core/model/Warehouse";
import { color } from "../ui/uiColor";

/** 预警消息只发给距仓库中心 8 格内玩家（v1 CapacityWarningService 口径） */
export const WARNING_MARGIN = 8;

const LEVEL_TEXT: Record<WarningLevel, string> = {
  warning: `${color.warn}警告`,
  full: `${color.error}满箱`,
};

/** 距仓库中心 XZ 距离是否在范围内 */
function near(warehouse: Warehouse, player: { dimension: string; x: number; z: number }, range: number): boolean {
  if (player.dimension !== warehouse.area.dimension) return false;
  const a = warehouse.area;
  const cx = (Math.min(a.corner1.x, a.corner2.x) + Math.max(a.corner1.x, a.corner2.x)) / 2;
  const cz = (Math.min(a.corner1.z, a.corner2.z) + Math.max(a.corner1.z, a.corner2.z)) / 2;
  return Math.hypot(player.x - cx, player.z - cz) <= range;
}

/** 订阅领域事件 warning：向附近玩家播报中文预警 */
export function registerWarningRelay(bus: EventBus, warehouses: () => Warehouse[]): void {
  bus.warning.subscribe((e: WarningEvent) => {
    try {
      const warehouse = warehouses().find((w) => w.id === e.warehouseId);
      if (warehouse === undefined) return;
      const text = LEVEL_TEXT[e.level] ?? e.level;
      const containerInfo = e.containerId !== undefined ? `（容器 ${e.containerId}）` : "";
      const message = `${color.error}[容量预警] 仓库 "${warehouse.displayName}"${containerInfo}：${text} 预警`;
      for (const p of world.getAllPlayers()) {
        if (near(warehouse, { dimension: p.dimension.id, x: p.location.x, z: p.location.z }, WARNING_MARGIN)) {
          p.sendMessage(message);
        }
      }
    } catch (err) {
      console.warn(`[item-route] 预警播报失败: ${err}`);
    }
  });
}
