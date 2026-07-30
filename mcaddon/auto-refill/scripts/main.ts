// ─── 自动替换主手消耗品 ──────────────────────────────────
// 当主手物品被消耗/破碎时，自动从背包中查找同类物品替换。
// 保留成就，无需开启作弊。
//
// 监听事件：
//   itemCompleteUse  — 使用完毕（食物/药水/弓/弩/三叉戟蓄力满）
//   itemReleaseUse   — 提前松开蓄力物品
//   itemUse           — 使用物品（放置方块/盾牌/钓鱼等）
//   itemUseOn         — 对方块使用物品（锄/锹/骨粉等）
//   playerBreakBlock  — 工具耐久耗尽破碎

import { world, EntityComponentTypes, EquipmentSlot, system, GameMode, type Player } from "@minecraft/server";

// ─── 通用替换逻辑 ──────────────────────────────────────

/**
 * 在主手为空时，从背包查找相同 typeId 的物品替换到主手。
 * 找到后播放 pop 音效。
 * @returns 是否成功替换
 */
function refillMainhand(player: Player, typeId: string): boolean {
  const inventory = player.getComponent(EntityComponentTypes.Inventory);
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  if (!inventory?.container || !equippable) return false;

  // 主手已有物品 → 不需要替换
  if (equippable.getEquipment(EquipmentSlot.Mainhand) !== undefined) return false;

  for (let slot = 0; slot < inventory.container.size; slot++) {
    const item = inventory.container.getItem(slot);
    if (!item) continue;
    if (item.typeId === typeId) {
      equippable.setEquipment(EquipmentSlot.Mainhand, item);
      inventory.container.setItem(slot, undefined);
      player.playSound("random.pop");
      return true;
    }
  }
  return false;
}

// ─── 事件订阅 ──────────────────────────────────────────

/**
 * 检查玩家是否为生存/冒险模式
 */
function isSurvivalOrAdventure(player: Player): boolean {
  const mode = player.getGameMode();
  return mode === GameMode.Survival || mode === GameMode.Adventure;
}

/**
 * 物品使用完毕 — 食物/药水/弓/弩/三叉戟等蓄力到满释放后
 */
world.afterEvents.itemCompleteUse.subscribe((event) => {
  const player = event.source;
  if (!isSurvivalOrAdventure(player)) return;
  refillMainhand(player, event.itemStack.typeId);
});

/**
 * 提前释放蓄力物品 — 弓/弩/三叉戟蓄力时提前松开
 */
world.afterEvents.itemReleaseUse.subscribe((event) => {
  const player = event.source;
  if (!isSurvivalOrAdventure(player)) return;
  if (event.itemStack !== undefined) {
    refillMainhand(player, event.itemStack.typeId);
  }
});

/**
 * 使用物品 — 放置方块/盾牌/钓鱼竿/打火石等
 */
world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  if (!isSurvivalOrAdventure(player)) return;
  if (event.itemStack !== undefined) {
    refillMainhand(player, event.itemStack.typeId);
  }
});

/**
 * 方块破碎 — 工具耐久耗尽自动替换同类工具
 */
world.afterEvents.playerBreakBlock.subscribe((event) => {
  const player = event.player;
  if (!isSurvivalOrAdventure(player)) return;
  if (event.itemStackBeforeBreak !== undefined && event.itemStackAfterBreak === undefined) {
    refillMainhand(player, event.itemStackBeforeBreak.typeId);
  }
});
