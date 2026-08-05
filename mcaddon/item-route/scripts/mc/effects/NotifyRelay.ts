// ─── 成员通知：容器变更 / 生命周期事件 / 输入堵塞 → 在线成员（附近）播报 ──
// 对应三条需求：
//   · container-changed —— 容器注册/更新/移除 → 通知**owner + 所有在线成员**
//   · lifecycle-changed —— 仓库激活/停用 → 只通知**附近**的在线成员（中心直线距离判定）
//   · input-blocked —— 输入堵塞无法分拣 → 附近成员**防抖**提醒（30 秒窗口，避免每 tick 刷屏）
// "成员" = owner + member（访客/普通玩家不打扰）。
import { world, system } from "@minecraft/server";
import type { EventBus, ContainerChangedEvent, LifecycleChangedEvent, InputBlockedEvent } from "../../core/events/DomainEvents";
import type { Warehouse } from "../../core/model/Warehouse";
import { isPlayerNearby, type PlayerPosition } from "../../core/model/Area";
import { getChineseName } from "../../core/data/ItemNameMap";
import { PROXIMITY_MARGIN } from "../adapters/McProximityChecker";
import { chat } from "../ui/uiColor";

/** 输入堵塞通知防抖窗口（tick；600 = 30 秒 @20tps） */
const BLOCK_NOTIFY_COOLDOWN_TICKS = 600;

export function registerNotifyRelay(bus: EventBus, warehouses: () => Warehouse[]): void {
  // 输入堵塞防抖表：containerId → 上次通知 tick
  const lastBlockNotify = new Map<string, number>();

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

  // 输入堵塞 → 附近成员防抖提醒（30 秒窗口，持续堵塞时周期提醒而非刷屏）
  bus.inputBlocked.subscribe((e: InputBlockedEvent) => {
    try {
      const wh = warehouses().find((w) => w.id === e.warehouseId);
      if (wh === undefined) return;
      const now = system.currentTick;
      const last = lastBlockNotify.get(e.containerId) ?? -Infinity;
      if (now - last < BLOCK_NOTIFY_COOLDOWN_TICKS) return;
      lastBlockNotify.set(e.containerId, now);
      const name = getChineseName(e.itemId);
      const msg = `${chat.warn}[输入堵塞] ${e.containerId} 有 ${e.amount} 个${name}无法分拣（目标满/无匹配分类），请扩容或调整容器`;
      for (const p of nearbyMembers(wh)) p.sendMessage(msg);
    } catch (err) {
      console.warn(`[item-route] 输入堵塞通知失败: ${err}`);
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