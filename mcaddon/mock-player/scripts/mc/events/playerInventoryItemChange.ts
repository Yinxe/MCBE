// ─── playerInventoryItemChange — 模拟玩家背包变化实时持久化 ─
//
// 当假人捡起物品、移动物品、丢弃物品、合成等操作时触发
// 每次只保存变化的单格（slot），避免全量读写
// 仅对模拟玩家生效（通过 BOT_TAG 过滤）
//
// 额外职责：检视主手工具耐久，触发自动补充（toolHealth）
//
// ⚠️ 注意：此事件不覆盖装备栏（头盔/胸甲/护腿/靴子/副手）
// 装备变化需要通过 100tick 周期 + entityDie/offlineBot 兜底
//
// PlayerInventoryType 只有 Hotbar(0-8) 和 Inventory(9-35) 两种
// 不包含装备槽

import { PlayerInventoryItemChangeAfterEvent } from "@minecraft/server";

import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { BOT_TAG } from "../../core/tags/BotTags";
import { serializeItemStack } from "../adapters/McItemCodec";
import { checkMainHandDurability } from "../features/toolHealth";

export function onPlayerInventoryItemChange(event: PlayerInventoryItemChangeAfterEvent): void {
  const { player, slot, itemStack, beforeItemStack } = event;
  if (!player.hasTag(BOT_TAG)) return;
  // 假人刚生成时背包为空，恢复完成前禁止保存单格数据
  if (!botRegistry.isRestored(player.name)) return;

  // afterEvents 回调不在受限模式运行，可直接序列化
  // saveCoordinator.saveSlot 内部输出"什么变了"日志（变化前 → 变化后）
  const serialized = itemStack ? serializeItemStack(itemStack) : null;
  const before = beforeItemStack ? serializeItemStack(beforeItemStack) : null;
  saveCoordinator.saveSlot(player.name, slot, serialized, before);

  // 检查主手工具耐久，必要时自动补充
  checkMainHandDurability(player, slot);
}
