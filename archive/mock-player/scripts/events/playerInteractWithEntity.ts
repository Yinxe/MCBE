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

export function onPlayerInteractWithEntity(event: PlayerInteractWithEntityBeforeEvent): void {
  const { player, target, itemStack } = event;
  try {
    if (!target.hasTag(TAG_BOT.value)) return;
  } catch {
    return;
  }
  console.info(`[MockPlayer] 交互 ${(target as Player).name}（手持 ${itemStack?.typeId ?? "空"} 潜行=${player.isSneaking}）`);
  event.cancel = true;
  system.run(() => {
    if (player.isSneaking) {
      showTagManagement(player, (target as Player).name);
    } else {
      showBotPanel(player, (target as Player).name);
    }
  });
}
