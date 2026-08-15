// ─── itemUse — 木棍使用 → 打开主菜单 ────────────────────

import { world, ItemUseAfterEvent } from "@minecraft/server";

import { showMainMenu } from "../interaction/ui/menu";

/** 触发主菜单的快捷物品 ID */
const MENU_TRIGGER_ITEM = "minecraft:stick";

export function onItemUse(event: ItemUseAfterEvent): void {
  const item = event.itemStack;
  if (!item || item.typeId !== MENU_TRIGGER_ITEM) return;
  showMainMenu(event.source);
}
