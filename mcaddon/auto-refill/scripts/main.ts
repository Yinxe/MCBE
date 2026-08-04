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

// ─── 通用替换逻辑（交换 + 堆叠）────────────────────────

/**
 * 主手物品耗尽后自动补充：交换 + 堆叠统一逻辑。
 *
 * 1. 主手仍有同类物品（未耗尽）→ 不需要替换
 * 2. 从背包查找同类物品，与主手交换位置
 * 3. 交换后残留物（如喝药后的空瓶）交给 Container.addItem：
 *    优先堆叠到已有同类堆，其次填入首个空槽；背包满则剩余留在槽位
 *
 * 覆盖场景：食物/药水（空瓶回填）/弓弩蓄力/工具破碎/交互消耗等，
 * 无需按物品类型特判。
 *
 * @param player 目标玩家
 * @param typeId 需要补充的物品类型
 * @returns 是否成功替换
 */
function refillMainhand(player: Player, typeId: string): boolean {
  const inventory = player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent | undefined;
  const equippable = player.getComponent(EntityComponentTypes.Equippable) as EntityEquippableComponent | undefined;
  if (!inventory?.container || !equippable) return false;

  // 主手残留物（可能为空：物品耗尽；也可能非空：如喝药后的空瓶）
  const mainhand = equippable.getEquipment(EquipmentSlot.Mainhand);
  // 主手仍是同类物品（未耗尽）→ 不需要替换
  if (mainhand && mainhand.typeId === typeId) return false;

  for (let slot = 0; slot < inventory.container.size; slot++) {
    const item = inventory.container.getItem(slot);
    if (!item) continue;
    if (item.typeId !== typeId) continue;

    // 交换：主手 ← 背包同类；残留物 → 背包槽位
    equippable.setEquipment(EquipmentSlot.Mainhand, item);
    if (mainhand) {
      // 残留物交给 addItem：优先堆叠到已有同类堆，其次填入首个空槽；背包满则剩余留回该槽位
      let remaining: ItemStack | undefined;
      try {
        remaining = inventory.container.addItem(mainhand);
      } catch {
        remaining = mainhand; // 添加失败 → 残留物留在交换槽位
      }
      inventory.container.setItem(slot, remaining ?? undefined);
    } else {
      inventory.container.setItem(slot, undefined);
    }

    player.playSound("random.pop");
    console.info(`[AutoRefill] 替换 ${player.name}: ${typeId} ← slot ${slot}`);
    return true;
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
