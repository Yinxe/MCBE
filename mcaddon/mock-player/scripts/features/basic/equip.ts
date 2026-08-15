// ─── 装备互换（主手/副手/全部装备） ───────────────────────

import { Player, EquipmentSlot } from "@minecraft/server";

import type { EquipChangeVia } from "../../events/DomainEvents";
import { BotEvents } from "../../events/DomainEvents";
import type { EquipSlotName } from "../../rules/Types";
import { SWAP_SLOTS, EQUIP_SLOT_MAP } from "./EquipmentSlots";

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

/** EquipmentSlot → 装备槽名（非装备槽返回 undefined） */
function slotNameOf(slot: EquipmentSlot): EquipSlotName | undefined {
  const entry = Object.entries(EQUIP_SLOT_MAP).find(([, s]) => s === slot);
  return entry?.[0] as EquipSlotName | undefined;
}

/** 装备槽变化领域事件触发（槽位粒度：InventoryStorage 订阅后快照对比保存） */
function triggerEquipChange(bot: Player, slot: EquipmentSlot, via: EquipChangeVia): void {
  const name = slotNameOf(slot);
  if (name) BotEvents.botEquipSlotChanged.trigger({ botName: bot.name, slot: name, via });
}

// ─── 交换 ──────────────────────────────────────────────

/** 与假人互换主手物品 */
export function swapMainhandWithBot(player: Player, bot: Player): boolean {
  const both = getBothEquip(player, bot);
  if (!both) return false;
  swapSlot(both[0], both[1], EquipmentSlot.Mainhand);
  console.info(`[MockPlayer] 交换主手 ${bot.name} ←→ ${player.name}`);
  return true;
}

/** 与假人互换副手物品 */
export function swapOffhandWithBot(player: Player, bot: Player): boolean {
  const both = getBothEquip(player, bot);
  if (!both) return false;
  swapSlot(both[0], both[1], EquipmentSlot.Offhand);
  console.info(`[MockPlayer] 交换副手 ${bot.name} ←→ ${player.name}`);
  triggerEquipChange(bot, EquipmentSlot.Offhand, "swap");
  return true;
}

/** 与假人互换全部装备（头盔/胸甲/护腿/靴子/副手） */
export function swapEquipmentWithBot(player: Player, bot: Player): boolean {
  const both = getBothEquip(player, bot);
  if (!both) return false;
  for (const slot of SWAP_SLOTS) {
    swapSlot(both[0], both[1], slot);
    triggerEquipChange(bot, slot, "swap");
  }
  console.info(`[MockPlayer] 交换装备 ${bot.name} ←→ ${player.name}`);
  return true;
}
