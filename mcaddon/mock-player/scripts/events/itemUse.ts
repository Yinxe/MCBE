// ─── itemUse — 触发信物使用 → 打开主菜单 ─────────────
// 信物可在管理员菜单中配置（参考 item-route），默认木棍，选"无"则仅命令触发。

import { ItemUseAfterEvent } from "@minecraft/server";

import { BOT_TAG } from "../rules/tags/BotTags";
import { showMainMenu } from "../interaction/ui/menu";
import { configStore } from "../bootstrap/context";

export function onItemUse(event: ItemUseAfterEvent): void {
  // 假人（SimulatedPlayer）也会触发 itemUse（AI useItemInSlot 等），不应给自己打开菜单
  if (event.source.hasTag(BOT_TAG)) return;

  const trigger = configStore.getMenuTriggerItemId();
  if (trigger === null) return; // 仅命令触发
  const item = event.itemStack;
  if (!item || item.typeId !== trigger) return;
  showMainMenu(event.source);
}
