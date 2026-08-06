// ─── 成员通知：容器注册/拆除/合并拆半/生命周期/输入堵塞 → 在线成员播报 ──
// 通知渠道（"成员" = owner + member，访客/普通玩家不打扰）：
//   · container-added         —— 新容器注册（放置/扫描） → 通知**所有在线成员**
//   · container-removed       —— 容器拆除（完全拆箱） → 通知**所有在线成员**
//   · container-registry-changed —— 合箱(merge)/拆箱(split)/属性变更(property) → 通知**所有在线成员**
//     （事件带 reason 区分；用容器**短名** (x,y,z) 作通知，避免超长 ID）
//   · lifecycle-changed       —— 仓库激活/停用/停机 → 通知**所有在线成员**
//   · input-blocked           —— 输入堵塞无法分拣 → **附近**成员防抖提醒（30 秒窗口，避免每 tick 刷屏）
// ⚠️ 刻意**不订阅 container-changed**（内容变更）：该事件在路由/整理/**任何玩家开箱**（代理信号）
//   都触发，属高频噪声、非可执行事件——订阅会导致"非信物交互也刷屏容器已更新"（v1 不通知内容）。
// 全部事件驱动、不轮询；回调 try/catch 隔离（单事件崩溃不影响其他订阅者）。
import { world, system } from "@minecraft/server";
import type {
  EventBus,
  ContainerAddedEvent,
  ContainerRemovedEvent,
  ContainerRegistryChangedEvent,
  LifecycleChangedEvent,
  InputBlockedEvent,
} from "../../core/events/DomainEvents";
import type { Warehouse } from "../../core/model/Warehouse";
import type { ContainerId } from "../../core/model/types";
import { isPlayerNearby, type PlayerPosition } from "../../core/model/Area";
import { getChineseName } from "../../core/data/ItemNameMap";
import { PROXIMITY_MARGIN } from "../adapters/McProximityChecker";
import { chat } from "../ui/uiColor";

/** 输入堵塞通知防抖窗口（tick；600 = 30 秒 @20tps） */
const BLOCK_NOTIFY_COOLDOWN_TICKS = 600;

/** 容器短名（通知用）：`c@(x,y,z)@dim` → `(x,y,z)`，避免长 ID 刷屏 */
function shortId(containerId: ContainerId): string {
  return containerId.split("@")[1] ?? containerId;
}

/**
 * 注册成员通知订阅（装配层调用一次）：容器注册/拆除/合并拆半/生命周期/堵塞 → 在线成员播报。
 * 基于事件驱动、不轮询；任何回调异常隔离（不影响其他订阅者）。
 *
 * @param bus        - 领域事件总线
 * @param warehouses - 当前已加载仓库解析器（按 id 反查）
 */
export function registerNotifyRelay(bus: EventBus, warehouses: () => Warehouse[]): void {
  const lastBlockNotify = new Map<string, number>();

  // 新容器注册（放置/扫描） → 所有在线成员
  bus.containerAdded.subscribe((e: ContainerAddedEvent) => {
    try {
      const wh = warehouses().find((w) => w.id === e.warehouseId);
      if (wh === undefined) return;
      const msg = `${chat.success}[容器] ${shortId(e.containerId)} 新注册`;
      for (const p of onlineMembers(wh)) p.sendMessage(msg);
    } catch (err) {
      console.warn(`[item-route] 容器注册通知失败: ${err}`);
    }
  });

  // 容器完全拆除 → 所有在线成员
  bus.containerRemoved.subscribe((e: ContainerRemovedEvent) => {
    try {
      const wh = warehouses().find((w) => w.id === e.warehouseId);
      if (wh === undefined) return;
      const msg = `${chat.warn}[容器] ${shortId(e.containerId)} 已移除`;
      for (const p of onlineMembers(wh)) p.sendMessage(msg);
    } catch (err) {
      console.warn(`[item-route] 容器拆除通知失败: ${err}`);
    }
  });

  // 合箱/拆箱/属性变更（reason 区分）→ 所有在线成员
  bus.containerRegistryChanged.subscribe((e: ContainerRegistryChangedEvent) => {
    try {
      const wh = warehouses().find((w) => w.id === e.warehouseId);
      if (wh === undefined) return;
      const name = shortId(e.containerId);
      const msg =
        e.reason === "merge"
          ? `${chat.success}[容器] ${name} 已合并为大箱子`
          : e.reason === "split"
            ? `${chat.warn}[容器] ${name} 已降级为单箱`
            : `${chat.info}[容器] ${name} 角色/几何已变更`;
      for (const p of onlineMembers(wh)) p.sendMessage(msg);
    } catch (err) {
      console.warn(`[item-route] 容器合并/拆半通知失败: ${err}`);
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
      const msg = `${chat.warn}[输入堵塞] ${shortId(e.containerId)} 有 ${e.amount} 个${name}无法分拣（目标满/无匹配分类），请扩容或调整容器`;
      for (const p of nearbyMembers(wh)) p.sendMessage(msg);
    } catch (err) {
      console.warn(`[item-route] 输入堵塞通知失败: ${err}`);
    }
  });

  // 生命周期 → **所有在线成员**（激活/停用/停机）
  bus.lifecycleChanged.subscribe((e: LifecycleChangedEvent) => {
    try {
      const wh = warehouses().find((w) => w.id === e.warehouseId);
      if (wh === undefined) return;
      const action = e.to === "active" ? "已激活分拣" : e.to === "inactive" ? "已停用" : `进入 ${e.to}`;
      const msg = `${chat.warn}[仓库] "${wh.displayName}" ${action}`;
      for (const p of onlineMembers(wh)) p.sendMessage(msg);
    } catch (err) {
      console.warn(`[item-route] 生命周期通知失败: ${err}`);
    }
  });
}

/** 在线成员（owner + member 的玩家对象） */
function onlineMembers(warehouse: Warehouse): ReturnType<typeof world.getAllPlayers> {
  const ids = new Set([warehouse.ownerName, ...warehouse.members.map((m) => m.playerName)]);
  return world.getAllPlayers().filter((p) => ids.has(p.name));
}

/** 附近（中心直线距离 ≤ 外接圆半径 + margin）的在线成员 */
function nearbyMembers(warehouse: Warehouse): ReturnType<typeof world.getAllPlayers> {
  return onlineMembers(warehouse).filter((p) => {
    if (p.dimension.id !== warehouse.area.dimension) return false;
    const pos: PlayerPosition = { dimension: p.dimension.id, x: p.location.x, z: p.location.z };
    return isPlayerNearby(warehouse.area, [pos], PROXIMITY_MARGIN);
  });
}
