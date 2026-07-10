// ─── playerInteractWithEntity — 站立→操作面板 / 潜行→标签 ─
//
// 交互逻辑：
//   站立 + 长按 → 打开操作面板（无空手条件限制）
//   潜行 + 长按 → 打开标签管理（无空手条件限制）
//
// ⚠️ 踩坑：
//   beforeEvents 回调运行在 restricted-execution mode
//   不能直接调用 form.show()，需要用 system.run() 延迟执行

import { system, Player, PlayerInteractWithEntityBeforeEvent } from "@minecraft/server";

import { TAG_BOT } from "../features/core/tags";
import { showBotPanel } from "../ui/bot";
import { showTagManagement } from "../ui/tags";

export function onPlayerInteractWithEntity(event: PlayerInteractWithEntityBeforeEvent): void {
  const { player, target, itemStack } = event;

  // 不是模拟玩家则不处理
  if (!target.hasTag(TAG_BOT.value)) return;
  console.warn(`[MockPlayer] 交互 ${(target as Player).name}（手持 ${itemStack?.typeId ?? "空"} 潜行=${player.isSneaking}）`);

  // 取消默认交互行为（玩家之间默认行为不可预测）
  event.cancel = true;

  // before 回调在 restricted mode，需要 system.run 延迟执行
  system.run(() => {
    if (player.isSneaking) {
      showTagManagement(player, (target as Player).name);
    } else {
      showBotPanel(player, (target as Player).name);
    }
  });
}
