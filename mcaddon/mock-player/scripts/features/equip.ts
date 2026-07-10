// ─── 装备互换/卸甲 ─────────────────────────────────────

import { Player, EquipmentSlot } from "@minecraft/server";

import { BotRecord } from "./core/types";
import { SWAP_SLOTS } from "./core/types";
import { serializeEquipment, captureExperience, getEquipmentSlot } from "./core/utils";
import { botRegistry, saveBotEquipment, saveBotRecord } from "./core/persistence";

// ─── 内部工具 ──────────────────────────────────────────

function swapSlot(pEquip: any, bEquip: any, slot: EquipmentSlot): void {
  const pItem = pEquip.getEquipment(slot);
  const bItem = bEquip.getEquipment(slot);
  pEquip.setEquipment(slot, bItem);
  bEquip.setEquipment(slot, pItem);
}

function getBothEquip(player: Player, bot: Player): [any, any] | undefined {
  const p = player.getComponent("minecraft:equippable") as any;
  const b = bot.getComponent("minecraft:equippable") as any;
  return p && b ? [p, b] : undefined;
}

// ─── 交换 ──────────────────────────────────────────────

/** 与假人互换主手物品 */
export function swapMainhandWithBot(player: Player, bot: Player): boolean {
  const both = getBothEquip(player, bot);
  if (!both) return false;
  swapSlot(both[0], both[1], EquipmentSlot.Mainhand);
  console.warn(`[MockPlayer] 交换主手 ${bot.name} ←→ ${player.name}`);
  return true;
}

/** 与假人互换副手物品 */
export function swapOffhandWithBot(player: Player, bot: Player): boolean {
  const both = getBothEquip(player, bot);
  if (!both) return false;
  swapSlot(both[0], both[1], EquipmentSlot.Offhand);
  console.warn(`[MockPlayer] 交换副手 ${bot.name} ←→ ${player.name}`);
  return true;
}

/** 与假人互换全部装备（头盔/胸甲/护腿/靴子/副手） */
export function swapEquipmentWithBot(player: Player, bot: Player): boolean {
  const both = getBothEquip(player, bot);
  if (!both) return false;
  for (const slot of SWAP_SLOTS) swapSlot(both[0], both[1], slot);
  console.warn(`[MockPlayer] 交换装备 ${bot.name} ←→ ${player.name}`);
  return true;
}

// ─── 一键卸甲 ──────────────────────────────────────────

/** 一键卸甲：卸下假人主手 + 副手 + 全部装备，回收至玩家背包 */
export function unequipBotAll(player: Player, bot: Player): boolean {
  const bEquip = bot.getComponent("minecraft:equippable") as any;
  const pInv = player.getComponent("minecraft:inventory") as any;
  if (!bEquip || !pInv?.container) return false;

  // 所有要回收的槽：主手 + 5 装备槽
  const allSlots = [EquipmentSlot.Mainhand, ...SWAP_SLOTS];
  let count = 0;
  for (const slot of allSlots) {
    const item = bEquip.getEquipment(slot);
    if (!item) continue;
    bEquip.setEquipment(slot, undefined);
    count++;
    // 尝试放入玩家背包，放不下的掉落在地
    const remainder = pInv.container.addItem(item);
    if (remainder) {
      player.dimension.spawnItem(remainder, player.location);
    }
  }
  console.warn(`[MockPlayer] 一键卸甲 ${bot.name}——${count} 件 → ${player.name}`);
  return true;
}

// ─── 穿上装备 ──────────────────────────────────────────

/**
 * 将玩家手中的装备穿到假人身上（自动交换）
 * 在 system.run() 内调用
 */
export function equipBotArmor(bot: Player, player: Player, armorItem: any): boolean {
  const slot = getEquipmentSlot(armorItem.typeId);
  if (!slot) return false;

  const bEquip = bot.getComponent("minecraft:equippable") as any;
  if (!bEquip) return false;

  const currentItem = bEquip.getEquipment(slot);
  bEquip.setEquipment(slot, armorItem);

  // 处理玩家手中的物品变化
  const inv = player.getComponent("minecraft:inventory") as any;
  if (inv?.container) {
    const handSlot = player.selectedSlotIndex;
    if (currentItem) {
      // 假人原有装备 → 换到玩家手中
      inv.container.setItem(handSlot, currentItem);
    } else {
      // 假人该槽为空 → 消耗玩家手中的物品
      const handStack = inv.container.getItem(handSlot);
      if (handStack && handStack.amount > 1) {
        handStack.amount--;
        inv.container.setItem(handSlot, handStack);
      } else {
        inv.container.setItem(handSlot, undefined);
      }
    }
  }
  return true;
}

// ─── 装备状态保存 ──────────────────────────────────────

/**
 * 仅保存假人装备栏 + 经验（不含背包）
 * 用于互换/脱下装备等场景，避免全量扫描 36 格背包
 */
export function saveBotEquipState(bot: Player, record: BotRecord): void {
  const equip = bot.getComponent("minecraft:equippable") as any;
  if (equip) {
    saveBotEquipment(record.name, serializeEquipment(equip));
  }
  record.experience = captureExperience(bot);
  saveBotRecord(record);
  console.warn(`[MockPlayer] 装备状态保存完成 ${record.name}`);
}
