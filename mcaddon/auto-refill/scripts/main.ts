// ─── 自动替换主手消耗品 ──────────────────────────────────
// 当主手物品被消耗/破碎时，自动从背包中查找同类物品替换。
// 保留成就，无需开启作弊。
//
// 核心思路：交换 + 堆叠
//   1. 交换：主手即快捷栏选中槽（player.selectedSlotIndex），
//      用官方 Container.swapItems 一步交换主手与背包同类槽位，
//      原子操作，无复制/丢失风险
//   2. 堆叠：交换后原主手残留物（如喝药后的空瓶）留在槽位，
//      用官方 Container.transferItem 转移回背包，优先堆叠到
//      已有同类堆，其次填入空槽
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
  GameMode,
  type Player,
} from "@minecraft/server";

// ─── 通用替换逻辑（交换 + 堆叠）────────────────────────

/**
 * 交换主手与背包指定槽位的物品。
 * 主手即快捷栏选中槽（player.selectedSlotIndex），
 * 使用官方 Container.swapItems 一步完成，原子操作无复制/丢失风险。
 *
 * @param player 目标玩家
 * @param slot   背包槽位（必须非空）
 * @returns 是否成功
 */
function swapMainhandWithSlot(player: Player, slot: number): boolean {
  const inventory = player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent | undefined;
  if (!inventory?.container) return false;
  try {
    inventory.container.swapItems(player.selectedSlotIndex, slot, inventory.container);
    return true;
  } catch (e) {
    console.warn(`[AutoRefill] swap failed ${player.name}: slot ${slot} - ${e}`);
    return false;
  }
}

/**
 * 将槽位中的残留物堆叠回背包：优先堆叠到已有同类堆，其次填入空槽。
 * 使用官方 Container.transferItem 原子转移，全部放入则槽位自动清空。
 *
 * @param player 目标玩家
 * @param slot   残留物所在槽位
 * @returns 是否全部放入（true = 槽位已清空）
 */
function stackRemainder(player: Player, slot: number): boolean {
  const inventory = player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent | undefined;
  if (!inventory?.container) return false;
  try {
    return inventory.container.transferItem(slot, inventory.container) === undefined;
  } catch (e) {
    console.warn(`[AutoRefill] stack failed ${player.name}: slot ${slot} - ${e}`);
    return false;
  }
}

/**
 * 主手物品耗尽后自动补充：交换 + 堆叠。
 *
 * 1. 主手仍有同类物品（未耗尽）→ 不需要替换
 * 2. 从背包查找同类物品 → 交换主手与槽位
 * 3. 交换后残留物（如喝药后的空瓶）堆叠回背包
 * 4. 背包无同类物品（最后一件已用完）→ 主手残留物堆叠回背包
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
  if (!inventory?.container) return false;
  const container = inventory.container;
  const hotbarSlot = player.selectedSlotIndex;

  // 主手残留物（可能为空：物品耗尽；也可能非空：如喝药后的空瓶）
  const mainhand = container.getItem(hotbarSlot);
  // 主手仍是同类物品（未耗尽）→ 不需要替换
  if (mainhand && mainhand.typeId === typeId) return false;

  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (!item) continue;
    if (item.typeId !== typeId) continue;

    // 1. 交换：主手（hotbar 选中槽）↔ 背包槽位
    if (!swapMainhandWithSlot(player, slot)) return false;

    // 2. 堆叠：交换后残留物（如空瓶）已在槽位，回填背包
    if (container.getItem(slot)) {
      stackRemainder(player, slot);
    }

    player.playSound("random.pop");
    console.info(`[AutoRefill] 替换 ${player.name}: ${typeId} ← slot ${slot}`);
    return true;
  }

  // 3. 背包无同类物品（最后一件已用完）→ 主手残留物堆叠回背包
  if (mainhand) {
    stackRemainder(player, hotbarSlot);
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
