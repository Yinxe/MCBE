// ─── playerInventoryItemChange — 模拟玩家背包变化实时持久化 ─
//
// 当假人捡起物品、移动物品、丢弃物品、合成等操作时触发
// 每次只保存变化的单格（slot），避免全量读写
// 仅对模拟玩家生效（通过 BOT_TAG 过滤）
//
// 额外职责：检视主手工具耐久，触发自动补充（toolHealth）
//
// ⚠️ 注意：此事件不覆盖装备栏（头盔/胸甲/护腿/靴子/副手）
// 装备变化走 botEquipSlotChanged 领域事件（互换/穿卸/受伤触发）
//
// PlayerInventoryType 只有 Hotbar(0-8) 和 Inventory(9-35) 两种
// 不包含装备槽
//
// 薄壳职责：BOT_TAG 过滤 + 转发 InventoryStorage（isRestored 守卫与
// 保存逻辑在库存存储模块内部）

import { PlayerInventoryItemChangeAfterEvent } from "@minecraft/server";

import { BOT_TAG } from "../../core/tags/BotTags";
import { inventoryStorage } from "../bootstrap/context";
import { checkMainHandDurability } from "../features/toolHealth";

export function onPlayerInventoryItemChange(event: PlayerInventoryItemChangeAfterEvent): void {
  const { player, slot, itemStack, beforeItemStack } = event;
  if (!player.hasTag(BOT_TAG)) return;

  // 真实 ItemStack 直存 NBT 槽（完整 NBT，潜影盒内容随物品保存）
  inventoryStorage.saveInventorySlot(player, slot, itemStack ?? null, beforeItemStack ?? null);

  // 检查主手工具耐久，必要时自动补充
  checkMainHandDurability(player, slot);
}
