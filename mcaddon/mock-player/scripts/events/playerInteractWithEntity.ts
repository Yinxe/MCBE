// ─── playerInteractWithEntity — 空手→操作面板 / 持装备→穿戴到假人 ─

import { world, system, Player, PlayerInteractWithEntityBeforeEvent } from "@minecraft/server";

import { TAG_BOT } from "../features/tags";
import { isWearableItem } from "../features/utils";
import { equipBotArmor, saveBotEquipState } from "../features/operations";
import { botRegistry } from "../features/persistence";
import { showOperationPanel } from "../ui/menu";
import { showTagManagement } from "../ui/tags";

export function onPlayerInteractWithEntity(event: PlayerInteractWithEntityBeforeEvent): void {
  const { player, target, itemStack } = event;

  // 不是模拟玩家则不处理
  if (!target.hasTag(TAG_BOT.value)) return;

  // 手上有物品 → 判断是否为可穿戴装备
  if (itemStack && itemStack.typeId !== "minecraft:air") {
    if (isWearableItem(itemStack.typeId)) {
      // 穿戴装备到假人
      event.cancel = true;
      system.run(() => {
        const record = botRegistry.get((target as Player).name);
        if (equipBotArmor(target as Player, player, itemStack) && record) {
          saveBotEquipState(target as Player, record);
          player.sendMessage(`§a已为 §e${(target as Player).name}§a 穿戴装备`);
        }
      });
    }
    // 非装备物品 → 不处理，让默认行为继续
    return;
  }

  // 空手 → 取消默认交互并打开菜单
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
