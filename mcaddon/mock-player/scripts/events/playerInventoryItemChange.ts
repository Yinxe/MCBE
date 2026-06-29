// ─── playerInventoryItemChange — 模拟玩家背包变化实时持久化 ─
//
// 当假人捡起物品、移动物品、丢弃物品、合成等操作时触发
// 每次只保存变化的单格（slot），避免全量读写
// 仅对模拟玩家生效（通过 BOT_TAG 过滤）
//
// ⚠️ 注意：此事件不覆盖装备栏（头盔/胸甲/护腿/靴子/副手）
// 装备变化需要通过 100tick 周期 + entityDie/offlineBot 兜底
//
// PlayerInventoryType 只有 Hotbar(0-8) 和 Inventory(9-35) 两种
// 不包含装备槽

import { world, system, PlayerInventoryItemChangeAfterEvent } from "@minecraft/server";

import { BOT_TAG } from "../features/types";
import { saveBotSlot, isBotRestored } from "../features/persistence";
import { serializeItemStack } from "../features/utils";

export function onPlayerInventoryItemChange(event: PlayerInventoryItemChangeAfterEvent): void {
  const { player, slot, itemStack } = event;
  if (!player.hasTag(BOT_TAG)) return;
  // 假人刚生成时背包为空，恢复完成前禁止保存单格数据
  if (!isBotRestored(player.name)) return;

  // ⚠️ 事件回调可能运行在受限模式（getCanDestroy 等 ItemStack 方法受限）
  // 使用 system.run 切换到主 tick 执行序列化
  system.run(() => {
    const serialized = itemStack ? serializeItemStack(itemStack) : null;
    saveBotSlot(player.name, slot, serialized);
    console.warn(`[MockPlayer] 背包变化 ${player.name} slot=${slot} ${itemStack?.typeId ?? "空"}`);
  });
}
