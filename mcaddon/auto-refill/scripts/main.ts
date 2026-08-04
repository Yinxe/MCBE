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
      console.info(`[AutoRefill] 替换 ${player.name}: ${typeId} ← slot ${slot}`);
      return true;
    }
  }
  return false;
}

/**
 * 药水特例：喝药后主手剩空瓶（glass_bottle），
 * 从背包找新药水换上；空瓶优先堆叠进背包已有同种瓶，
 * 堆叠满再找空位放，放不下则溢出掉落。
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
      equippable.setEquipment(EquipmentSlot.Mainhand, item);
      // 扣除背包中的药水（getItem 返回副本，setEquipment 不会移除原槽位）
      inventory.container.setItem(slot, undefined);

      // 空瓶回填：优先堆叠，其次空位，最后溢出掉落
      const remaining = inventory.container.addItem(mainhand);
      if (remaining) {
        // addItem 返回余量说明背包已满/堆叠满 → 溢出到玩家位置
        try {
          player.dimension.spawnItem(remaining, {
            x: player.location.x,
            y: player.location.y + 1,
            z: player.location.z,
          });
        } catch { /* 溢出失败时忽略 */ }
      }

      player.playSound("random.pop");
      console.info(`[AutoRefill] 药水替换 ${player.name}: ${potionTypeId}（空瓶回填）`);
      return true;
    }
  }
  return false;
}

// ─── 事件订阅 ──────────────────────────────────────────

/**
 * 判断是否为真实玩家（非模拟玩家）。
 * 假人标识 tag（mock-player 模组给所有假人打的标），带 tag 即假人。
 */
function isRealPlayer(player: Player): boolean {
  return !player.hasTag("mockplayer:tag:bot");
}

/**
 * 判断玩家是否为生存/冒险模式。
 * 模拟玩家的 getGameMode() 会抛异常或返回 undefined，此时返回 false。
 */
function isSurvivalOrAdventure(player: Player): boolean {
  let mode: GameMode | undefined;
  try {
    mode = player.getGameMode();
  } catch {
    return false;
  }
  if (mode === undefined) return false;
  return mode === GameMode.Survival || mode === GameMode.Adventure;
}

/**
 * 目标校验通过后执行回调。
 * 统一守卫：实体存在 → 真实玩家（非假人）→ 生存/冒险模式。
 * @param player   玩家实体（可能为 undefined）
 * @param callback 校验通过后要执行的替换逻辑
 */
function ifRefillEligible(player: Player | undefined, callback: (p: Player) => void): void {
  if (!player) return;
  if (!isRealPlayer(player)) return;
  if (!isSurvivalOrAdventure(player)) return;
  callback(player);
}

/**
 * 物品使用完毕 — 食物/药水/弓/弩/三叉戟等蓄力到满释放后
 */
world.afterEvents.itemCompleteUse.subscribe((event) => {
  ifRefillEligible(event.source, (player) => {
    if (!event.itemStack) return;
    // 药水特例：喝药后主手变空瓶 → 替换新药水并回填空瓶
    if (event.itemStack.typeId === "minecraft:potion") {
      if (refillPotion(player, event.itemStack.typeId)) {
        return;
      }
    }
    refillMainhand(player, event.itemStack.typeId);
  });
});

/**
 * 提前释放蓄力物品 — 弓/弩/三叉戟蓄力时提前松开
 */
world.afterEvents.itemReleaseUse.subscribe((event) => {
  ifRefillEligible(event.source, (player) => {
    if (event.itemStack !== undefined) {
      refillMainhand(player, event.itemStack.typeId);
    }
  });
});

/**
 * 使用物品 — 放置方块/盾牌/钓鱼竿/打火石等
 */
world.afterEvents.itemUse.subscribe((event) => {
  ifRefillEligible(event.source, (player) => {
    if (event.itemStack !== undefined) {
      refillMainhand(player, event.itemStack.typeId);
    }
  });
});

/**
 * 对方块使用物品 — 锄地/锹土/骨粉等
 * 2.0.0 中替代已移除的 itemUseOn 事件。
 * 交互成功后主手物品可能消失（消耗类），此时自动替换。
 */
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  ifRefillEligible(event.player, (player) => {
    // 交互前的物品类型（beforeItemStack 是交互前主手拿的物品）
    const usedType = event.beforeItemStack?.typeId ?? event.itemStack?.typeId;
    if (!usedType) return;
    // 交互成功后主手可能已被消耗 → 自动替换同类
    refillMainhand(player, usedType);
  });
});

/**
 * 方块破碎 — 工具耐久耗尽自动替换同类工具
 */
world.afterEvents.playerBreakBlock.subscribe((event) => {
  ifRefillEligible(event.player, (player) => {
    if (event.itemStackBeforeBreak === undefined) return;
    if (event.itemStackAfterBreak !== undefined) return;
    refillMainhand(player, event.itemStackBeforeBreak.typeId);
  });
});
