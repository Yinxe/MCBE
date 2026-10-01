// ─── 事件注册中心 — 非生命周期事件统一订阅 ────────
//  lifecycle 相关（playerJoin/playerLeave/entityDie/playerSpawn/
//  playerInventoryItemChange/装备槽/位置）已内聚至 lifecycle 模块：
//    SessionComponent  → playerJoin / playerLeave
//    DeathComponent    → entityDie / playerSpawn
//    InventoryComponent→ playerInventoryItemChange + botEquipSlotChanged
//    PositionComponent → botMoved
//  均在 bootstrap/context 阶段随 botLifecycle 创建时自动订阅，集中维护。
//  木棍菜单唯一注册点：interaction/ui/menuTrigger.ts（单例 itemUse → showMainMenu）
//  此处仅保留与生命周期/木棍菜单无关的交互/行为事件，避免任何重复订阅。

import { world } from "@minecraft/server";

import { onPlayerInteractWithEntity } from "./playerInteractWithEntity";
import { registerBotActionEvents } from "./botActions";
import { registerMenuTrigger } from "../interaction/ui/menuTrigger";

let registered = false;
export function registerAllEvents(): void {
  if (registered) {
    console.warn(`[events] registerAllEvents 重复调用，已忽略（防重复订阅导致双倍通知）`);
    return;
  }
  registered = true;

  // 木棍菜单唯一注册（单例 itemUse → showMainMenu）
  registerMenuTrigger();

  // 实体交互（bot 面板/标签）
  world.beforeEvents.playerInteractWithEntity.subscribe(onPlayerInteractWithEntity);

  // 假人行为领域事件（主手切换/破坏/放置/使用/攻击）
  registerBotActionEvents();
}
