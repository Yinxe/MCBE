// ─── itemUse — 木棍使用 → 打开主菜单 ────────────────────

import { ItemUseAfterEvent } from "@minecraft/server";

import { BOT_TAG } from "../rules/tags/BotTags";
import { showMainMenu } from "../interaction/ui/menu";

/** 触发主菜单的快捷物品 ID */
const MENU_TRIGGER_ITEM = "minecraft:stick";

export function onItemUse(event: ItemUseAfterEvent): void {
  // 假人（SimulatedPlayer）也会触发 itemUse（AI useItemInSlot 等），不应给自己打开菜单
  if (event.source.hasTag(BOT_TAG)) return;

  const item = event.itemStack;
  if (!item || item.typeId !== MENU_TRIGGER_ITEM) return;
  showMainMenu(event.source);
}
