// ─── 成员通知：容器变更 / 生命周期事件 → 在线成员（附近）播报 ──
// 对应两条需求：
//   · container-changed —— 容器注册/更新/移除 → 通知**owner + 所有在线成员**
//   · lifecycle-changed —— 仓库激活/停用 → 只通知**附近**的在线成员（中心直线距离判定）
// "成员" = owner + member（访客/普通玩家不打扰）。
import { world } from "@minecraft/server";
import type { EventBus, ContainerChangedEvent, LifecycleChangedEvent } from "../../core/events/DomainEvents";
import type { Warehouse } from "../../core/model/Warehouse";
import { isPlayerNearby, type PlayerPosition } from "../../core/model/Area";
import { PROXIMITY_MARGIN } from "../adapters/McProximityChecker";
import { chat } from "../ui/uiColor";

export function registerNotifyRelay(bus: EventBus, warehouses: () => Warehouse[]): void {
  // 容器变更 → 所有在线成员
  bus.containerChanged.subscribe((e: ContainerChangedEvent) => {
    try {
      const wh = warehouses().find((w) => w.id === e.warehouseId);
      if (wh === undefined) return;
      const msg = `${chat.info}[容器] ${e.containerId} 已更新`;
      for (const p of onlineMembers(wh)) p.sendMessage(msg);
    } catch (err) {
      console.warn(`[item-route] 容器通知失败: ${err}`);
    }
  });

  // 生命周期 → 附近在线成员
  bus.lifecycleChanged.subscribe((e: LifecycleChangedEvent) => {
    try {
      const wh = warehouses().find((w) => w.id === e.warehouseId);
      if (wh === undefined) return;
      const action = e.to === "active" ? "已激活分拣" : e.to === "inactive" ? "已停用" : `进入 ${e.to}`;
      const msg = `${chat.warn}[仓库] "${wh.displayName}" ${action}`;
      for (const p of nearbyMembers(wh)) p.sendMessage(msg);
    } catch (err) {
      console.warn(`[item-route] 生命周期通知失败: ${err}`);
    }
  });
}

/** 在线成员（owner + member 的玩家对象） */
function onlineMembers(warehouse: Warehouse): ReturnType<typeof world.getAllPlayers> {
  const ids = new Set([warehouse.ownerId, ...warehouse.members.map((m) => m.playerId)]);
  return world.getAllPlayers().filter((p) => ids.has(p.id));
}

/** 附近（中心直线距离 ≤ 外接圆半径 + margin）的在线成员 */
function nearbyMembers(warehouse: Warehouse): ReturnType<typeof world.getAllPlayers> {
  return onlineMembers(warehouse).filter((p) => {
    if (p.dimension.id !== warehouse.area.dimension) return false;
    const pos: PlayerPosition = { dimension: p.dimension.id, x: p.location.x, z: p.location.z };
    return isPlayerNearby(warehouse.area, [pos], PROXIMITY_MARGIN);
  });
}