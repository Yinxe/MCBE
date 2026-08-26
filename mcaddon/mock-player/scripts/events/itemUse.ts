// ─── itemUse — 触发信物使用 → 打开主菜单 ─────────────
// 信物可在管理员菜单中配置（参考 item-route），默认木棍，选"无"则仅命令触发。
// ⚠️ 修复双层菜单：Bedrock 长按/网络抖动会导致 itemUse 在 1-2 tick 内连续触发两次
//    （或与 playerInteractWithEntity 的 bot 面板同 tick 叠加），需 per-player 去重。

import { ItemUseAfterEvent, system } from "@minecraft/server";

import { BOT_TAG } from "../rules/tags/BotTags";
import { showMainMenu } from "../interaction/ui/menu";
import { configStore } from "../bootstrap/context";

/** 玩家级菜单去重：id → 上次打开时间戳（ms），与 playerInteractWithEntity 共享 */
const lastMenuOpen = new Map<string, number>();
const MENU_COOLDOWN_MS = 700;

function canOpenMenu(playerId: string): boolean {
  const now = Date.now();
  const last = lastMenuOpen.get(playerId) ?? 0;
  if (now - last < MENU_COOLDOWN_MS) return false;
  lastMenuOpen.set(playerId, now);
  // 10s 后清理防内存泄漏（玩家离线后 id 不再出现）
  system.runTimeout(() => {
    if ((lastMenuOpen.get(playerId) ?? 0) <= now) lastMenuOpen.delete(playerId);
  }, 200);
  return true;
}

/** 供 playerInteractWithEntity 复用：同一去重桶，避免 stick 触实体时主菜单与 bot 面板同 tick 双弹 */
export function tryClaimMenuCooldown(playerId: string): boolean {
  return canOpenMenu(playerId);
}

export function onItemUse(event: ItemUseAfterEvent): void {
  // 假人（SimulatedPlayer）也会触发 itemUse（AI useItemInSlot 等），不应给自己打开菜单
  if (event.source.hasTag(BOT_TAG)) return;

  const trigger = configStore.getMenuTriggerItemId();
  if (trigger === null) return; // 仅命令触发
  const item = event.itemStack;
  if (!item || item.typeId !== trigger) return;
  // 去重：700ms 内重复触发直接丢弃（修复双层菜单）
  if (!canOpenMenu(event.source.id)) return;
  // 延迟一 tick 再弹，避免与同一 tick 的 playerInteract 叠加
  system.run(() => showMainMenu(event.source));
}
