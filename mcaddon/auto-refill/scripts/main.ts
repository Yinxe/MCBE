// ─── 自动替换主手消耗品 ──────────────────────────────────
// 当主手物品被消耗/破碎时，自动从背包中查找同类物品替换。
// 保留成就，无需开启作弊。
//
// 监听事件：
//   itemCompleteUse            — 使用完毕（食物/药水/弓/弩/三叉戟蓄力满）
//   itemReleaseUse             — 提前松开蓄力物品
//   itemUse                    — 使用物品（放置方块/盾牌/钓鱼等）
//   playerInteractWithBlock    — 对方块使用物品（锄/锹/骨粉等）
//   playerBreakBlock           — 工具耐久耗尽破碎
//
// ⚠️ @minecraft/server 2.0.0 移除了 world.afterEvents.itemUseOn，
//    改用 playerInteractWithBlock 覆盖"对方块使用物品"场景。

import {
  world,
  EntityComponentTypes,
  EntityInventoryComponent,
  EntityEquippableComponent,
  EquipmentSlot,
  GameMode,
  type Player,
  type ItemStack,
} from "@minecraft/server";

// ─── 通用替换逻辑 ──────────────────────────────────────

/**
 * 在主手为空时，从背包查找相同 typeId 的物品替换到主手。
 * 找到后播放 pop 音效。
 * @returns 是否成功替换
 */
function refillMainhand(player: Player, typeId: string): boolean {
  const inventory = player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent | undefined;
  const equippable = player.getComponent(EntityComponentTypes.Equippable) as EntityEquippableComponent | undefined;
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

/**
 * 药水特例：喝药后主手剩空瓶（glass_bottle），
 * 从背包找新药水换上，空瓶放回原槽位。
 * @returns 是否成功替换
 */
function refillPotion(player: Player, potionTypeId: string): boolean {
  const inventory = player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent | undefined;
  const equippable = player.getComponent(EntityComponentTypes.Equippable) as EntityEquippableComponent | undefined;
  if (!inventory?.container || !equippable) return false;

  // 主手必须是空瓶（玻璃瓶）
  const mainhand = equippable.getEquipment(EquipmentSlot.Mainhand);
  if (mainhand?.typeId !== "minecraft:glass_bottle") return false;

  for (let slot = 0; slot < inventory.container.size; slot++) {
    const item = inventory.container.getItem(slot);
    if (!item) continue;
    if (item.typeId === potionTypeId) {
      const bottle = mainhand.clone();
      equippable.setEquipment(EquipmentSlot.Mainhand, item);
      inventory.container.setItem(slot, bottle);
      player.playSound("random.pop");
      return true;
    }
  }
  return false;
}

// ─── 事件订阅 ──────────────────────────────────────────

/**
 * 检查玩家是否为生存/冒险模式。
 * ⚠️ 兼容模拟玩家（SimulatedPlayer）：其 getGameMode() 可能抛异常或返回
 *    undefined，且模拟玩家默认都是生存模式，故失败时按生存处理。
 */
function isSurvivalOrAdventure(player: Player): boolean {
  try {
    const mode = player.getGameMode();
    if (mode === undefined) return true; // 模拟玩家无 mode → 默认生存
    return mode === GameMode.Survival || mode === GameMode.Adventure;
  } catch {
    // 模拟玩家 getGameMode 不可用 → 默认生存
    return true;
  }
}

/**
 * 物品使用完毕 — 食物/药水/弓/弩/三叉戟等蓄力到满释放后
 */
world.afterEvents.itemCompleteUse.subscribe((event) => {
  const player = event.source;
  if (!isSurvivalOrAdventure(player)) return;
  // 药水特例：喝药后主手变空瓶 → 替换新药水并回填空瓶
  if (event.itemStack.typeId === "minecraft:potion" && refillPotion(player, event.itemStack.typeId)) {
    return;
  }
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
 * 对方块使用物品 — 锄地/锹土/骨粉等
 * 2.0.0 中替代已移除的 itemUseOn 事件。
 * 交互成功后主手物品可能消失（消耗类），此时自动替换。
 */
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  const player = event.player;
  if (!isSurvivalOrAdventure(player)) return;

  // 交互前的物品类型（beforeItemStack 是交互前主手拿的物品）
  const usedType = event.beforeItemStack?.typeId ?? event.itemStack?.typeId;
  if (!usedType) return;

  // 交互成功后主手可能已被消耗 → 自动替换同类
  refillMainhand(player, usedType);
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
