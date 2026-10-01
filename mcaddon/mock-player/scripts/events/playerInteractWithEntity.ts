// ─── playerInteractWithEntity — 站立→操作面板 / 潜行→标签 ─
//
// 交互逻辑：
//   站立 + 长按 → 打开操作面板（任意物品均可）
//   潜行 + 长按 → 打开标签管理（任意物品均可）
//
// ⚠️ beforeEvents 回调运行在 restricted-execution mode
//   不能直接调用 form.show()，需要用 system.run() 延迟执行

import { system, Player, PlayerInteractWithEntityBeforeEvent } from "@minecraft/server";

import { TAG_BOT } from "../rules/tags/BotTags";
import { showBotPanel } from "../interaction/ui/bot";
import { showTagManagement } from "../interaction/ui/panels/tags";
import { showScriptPanel } from "../interaction/ui/panels/script";

/**
 * 最近一次「对着假人交互」的时间（玩家 ID → 毫秒时间戳）。
 * 供羽毛 itemUse 区分「对着假人」与「对着空气」，避免两个入口同时弹界面。
 */
export const recentBotInteractAt = new Map<string, number>();

export function onPlayerInteractWithEntity(event: PlayerInteractWithEntityBeforeEvent): void {
  const { player, target, itemStack } = event;
  try {
    if (!target.hasTag(TAG_BOT.value)) return;
  } catch {
    return;
  }
  console.info(`[MockPlayer] 交互 ${(target as Player).name}（手持 ${itemStack?.typeId ?? "空"} 潜行=${player.isSneaking}）`);
  event.cancel = true;
  recentBotInteractAt.set(player.id, Date.now());
  const botName = (target as Player).name;
  // 手持羽毛 → 直达该假人的编程界面（用户规格：羽毛对着哪个假人，就开哪个的编程页）
  const holdingFeather = itemStack?.typeId === "minecraft:feather";
  system.run(() => {
    if (holdingFeather) {
      showScriptPanel(player, botName);
      return;
    }
    if (player.isSneaking) {
      showTagManagement(player, botName);
    } else {
      showBotPanel(player, botName);
    }
  });
}
