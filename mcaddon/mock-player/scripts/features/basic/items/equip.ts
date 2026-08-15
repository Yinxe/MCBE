// ─── 装备互换（主手/副手/全部装备） ───────────────────────

import { Player, EquipmentSlot, system } from "@minecraft/server";

import type { EquipChangeVia } from "../../../events/DomainEvents";
import { BotEvents } from "../../../events/DomainEvents";
import type { EquipSlotName } from "../../../rules/Types";
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

// ─── 交换（闭包异步：system.run 调度到安全上下文执行） ────
// ⚠️ 统一纪律：永不 reject，任何异常 resolve false（异步环境抛异常可能致游戏崩溃）。
//    装备槽写入调度到 system.run 下一 tick，避免受限上下文/批量写入竞态。

/** 与假人互换主手物品（异步：执行结果 resolve） */
export function swapMainhandWithBot(player: Player, bot: Player): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    system.run(() => {
      try {
        const both = getBothEquip(player, bot);
        if (!both) { resolve(false); return; }
        swapSlot(both[0], both[1], EquipmentSlot.Mainhand);
        console.info(`[MockPlayer] 交换主手 ${bot.name} ←→ ${player.name}`);
        resolve(true);
      } catch (e: any) {
        console.warn(`[MockPlayer] 交换主手异常 ${bot.name}: ${e?.message ?? e}`);
        resolve(false);
      }
    });
  });
}

/** 与假人互换副手物品（异步：执行结果 resolve） */
export function swapOffhandWithBot(player: Player, bot: Player): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    system.run(() => {
      try {
        const both = getBothEquip(player, bot);
        if (!both) { resolve(false); return; }
        swapSlot(both[0], both[1], EquipmentSlot.Offhand);
        console.info(`[MockPlayer] 交换副手 ${bot.name} ←→ ${player.name}`);
        triggerEquipChange(bot, EquipmentSlot.Offhand, "swap");
        resolve(true);
      } catch (e: any) {
        console.warn(`[MockPlayer] 交换副手异常 ${bot.name}: ${e?.message ?? e}`);
        resolve(false);
      }
    });
  });
}

/** 与假人互换全部装备（头盔/胸甲/护腿/靴子/副手，异步：执行结果 resolve） */
export function swapEquipmentWithBot(player: Player, bot: Player): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    system.run(() => {
      try {
        const both = getBothEquip(player, bot);
        if (!both) { resolve(false); return; }
        for (const slot of SWAP_SLOTS) {
          swapSlot(both[0], both[1], slot);
          triggerEquipChange(bot, slot, "swap");
        }
        console.info(`[MockPlayer] 交换装备 ${bot.name} ←→ ${player.name}`);
        resolve(true);
      } catch (e: any) {
        console.warn(`[MockPlayer] 交换装备异常 ${bot.name}: ${e?.message ?? e}`);
        resolve(false);
      }
    });
  });
}
