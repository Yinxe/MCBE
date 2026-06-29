// ─── playerInteractWithEntity — 空手右击假人 → 操作面板 ─

import { world, system, Player, PlayerInteractWithEntityBeforeEvent } from "@minecraft/server";

import { TAG_BOT } from "../features/tags";
import { showOperationPanel } from "../ui/menu";
import { showTagManagement } from "../ui/tags";

export function onPlayerInteractWithEntity(event: PlayerInteractWithEntityBeforeEvent): void {
  const { player, target, itemStack } = event;

  // 不是模拟玩家则不处理
  if (!target.hasTag(TAG_BOT.value)) return;

  // 手上有非空物品则不处理
  if (itemStack && itemStack.typeId !== "minecraft:air") return;

  // 取消默认交互行为
  event.cancel = true;

  // before 回调在 restricted mode，需要 system.run 延迟执行
  system.run(() => {
    if (player.isSneaking) {
      showTagManagement(player, (target as Player).name);
    } else {
      showOperationPanel(player, (target as Player).name);
    }
  });
}
