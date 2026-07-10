// ─── itemUse — 木棍使用 → 打开主菜单 ────────────────────

import { world, ItemUseAfterEvent } from "@minecraft/server";

import { showMainMenu } from "../ui/menu";

export function onItemUse(event: ItemUseAfterEvent): void {
  const item = event.itemStack;
  if (!item || item.typeId !== "minecraft:stick") return;
  showMainMenu(event.source);
}
