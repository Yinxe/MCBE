// ─── 木棍菜单唯一注册点（所有木棍触发信物的 itemUse 均在此唯一订阅） ──
// 约束：木棍菜单只允许一个地方注册，避免重复订阅导致双层菜单
// 此模块为唯一真源，events/index 不再直接处理木棍，仅调用本模块的 register

import { system, world, type Player, type ItemUseAfterEvent } from "@minecraft/server";
import { BOT_TAG } from "../../rules/tags/BotTags";
import { configStore } from "../../bootstrap/context";
import { showMainMenu } from "./menu";

let registered = false;

/** 唯一注册木棍菜单触发（worldLoad 阶段调用一次） */
export function registerMenuTrigger(): void {
  if (registered) {
    console.warn(`[menuTrigger] 重复注册，已忽略`);
    return;
  }
  registered = true;
  world.afterEvents.itemUse.subscribe(onItemUse);
  console.info(`[menuTrigger] 木棍菜单已唯一注册（itemUse → showMainMenu）`);
}

function onItemUse(event: ItemUseAfterEvent): void {
  if (event.source.hasTag(BOT_TAG)) return;
  const trigger = configStore.getMenuTriggerItemId();
  if (trigger === null) return;
  const item = event.itemStack;
  if (!item || item.typeId !== trigger) return;
  system.run(() => showMainMenu(event.source as Player));
}
