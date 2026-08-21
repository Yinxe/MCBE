// ─── 物品互换面板（panelAction swap 订阅端） ──────────
// 面板按钮只发布事件（ui/bot.ts）；本文件订阅 swap 动作 → 弹互换表单 →
// 提交后直接执行容器/装备互换（并触发装备槽领域事件供持久化）。

import { Player, EquipmentSlot, ItemStack, system, world } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { BotEvents } from "../../../events/DomainEvents";
import { BotUiEvent } from "../../../events/UiEvents";
import { collectContainerItems } from "../../../features/basic/items";
import { inventoryContainerOf } from "../../../features/basic/items/ItemComponentRead";
import { saveCoordinator } from "../../../bootstrap/context";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { ensureUiBotAvailable, resolveUiBotRecord } from "../helpers";
import { swapMainhandWithBot } from "../../../features";

// ─── UI 事件订阅（BOT 主菜单 → 感知互换动作） ──────────

/** 订阅 BOT 主菜单动作事件：物品互换 → 弹表单（提交后直接执行） */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "swap") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    doSwap(player, e.botName);
  });
}

// ─── 工具 ──────────────────────────────────────────────

/** EquipmentSlot → 装备槽名（非装备槽返回 undefined；非装备槽不触发装备事件） */
function equipSlotNameOf(slot: EquipmentSlot): "head" | "chest" | "legs" | "feet" | "offhand" | undefined {
  switch (slot) {
    case EquipmentSlot.Head: return "head";
    case EquipmentSlot.Chest: return "chest";
    case EquipmentSlot.Legs: return "legs";
    case EquipmentSlot.Feet: return "feet";
    case EquipmentSlot.Offhand: return "offhand";
    default: return undefined;
  }
}

/** 互换装备/副手后触发槽位粒度装备变化事件（InventoryStorage 订阅保存） */
function triggerEquipChangeUI(bot: Player, slot: EquipmentSlot): void {
  const name = equipSlotNameOf(slot);
  if (name) {
    BotEvents.botEquipSlotChanged.trigger({ botName: bot.name, slot: name, via: "swap" });
  }
}


// ─── 互换面板 ──────────────────────────────────────────

/**
 * 互换面板（ModalForm 选择项目）
 * 可选：主手 / 副手 / 装备（头/胸/腿/靴）/ 背包（含主手）
 * 所有操作在同一 system.run 内执行，避免竞态
 */
function getMainhandInfo(bot: Player | SimulatedPlayer): string {
  try {
    const container = inventoryContainerOf(bot as any);
    if (!container) return `${color.muted}空`;
    const item = container.getItem((bot as any).selectedSlotIndex ?? 0);
    if (!item) return `${color.muted}空`;
    return `${color.playerName}${item.typeId.replace("minecraft:", "")} x${item.amount}`;
  } catch { return `${color.muted}空`; }
}

function getOffhandInfo(bot: Player | SimulatedPlayer): string {
  try {
    const comp = (bot as any).getComponent("minecraft:equippable");
    const item = comp?.getEquipment(EquipmentSlot.Offhand);
    if (!item) return `${color.muted}空`;
    return `${color.playerName}${item.typeId.replace("minecraft:", "")} x${item.amount ?? 1}`;
  } catch { return `${color.muted}空`; }
}

function getArmorInfo(bot: Player | SimulatedPlayer): string {
  try {
    const comp = (bot as any).getComponent("minecraft:equippable");
    if (!comp) return `${color.muted}空`;
    const slots = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
    const names = ["头盔", "胸甲", "护腿", "靴子"];
    const parts: string[] = [];
    let filled = 0;
    for (let i = 0; i < slots.length; i++) {
      const item = comp.getEquipment(slots[i]);
      if (item) {
        filled++;
        parts.push(`${names[i]}:${item.typeId.replace("minecraft:", "")}`);
      }
    }
    if (filled === 0) return `${color.muted}空 (0/4)`;
    return `${color.info}${filled}/4 ${color.muted}(${parts.join(" ")})`;
  } catch { return `${color.muted}空`; }
}

function getInventoryInfo(bot: Player | SimulatedPlayer): string {
  try {
    const container = inventoryContainerOf(bot as any);
    if (!container) return `${color.muted}0/36`;
    let count = 0;
    for (let i = 0; i < container.size; i++) if (container.getItem(i)) count++;
    return count === 0 ? `${color.muted}空 (0/36)` : `${color.info}${count}/36 格有物品`;
  } catch { return `${color.muted}0/36`; }
}

function doSwap(player: Player, botName: string): void {
  const r = resolveUiBotRecord(player, botName);
  if (!r) return;
  if (!ensureUiBotAvailable(player, r)) return;
  const bot = resolveBotPlayer(botName);
  if (!bot) { player.sendMessage(`${color.error}无法获取假人实体`); return; }

  const mainhandInfo = getMainhandInfo(bot);
  const offhandInfo = getOffhandInfo(bot);
  const armorInfo = getArmorInfo(bot);
  const inventoryInfo = getInventoryInfo(bot);

  new ModalFormBuilder()
    .title(`${color.bold}互换项目`)
    .toggle("mainhand", `互换主手: ${mainhandInfo}`, { defaultValue: false })
    .toggle("offhand", `互换副手: ${offhandInfo}`, { defaultValue: false })
    .toggle("armor", `互换装备: ${armorInfo}`, { defaultValue: false })
    .toggle("inventory", `互换背包: ${inventoryInfo}`, { defaultValue: false })
    .submitButton("互换")
    .show(player)
    .then((vals) => {
      if (!vals) return;
      const hasInv = vals.inventory as boolean;
      const hasMainhand = vals.mainhand as boolean;
      const hasOffhand = vals.offhand as boolean;
      const hasArmor = vals.armor as boolean;
      if (!hasInv && !hasMainhand && !hasOffhand && !hasArmor) {
        player.sendMessage(`${color.warn}未选择任何互换项目`);
        return;
      }

      system.run(() => {
        try {
          const done: string[] = [];

          // ── 背包（含主手）优先执行 ──
          if (hasInv) {
            const pContainer = inventoryContainerOf(player);
            const bContainer = inventoryContainerOf(bot);
            if (!pContainer || !bContainer) throw new Error("无法获取背包容器");
            const size = Math.min(pContainer.size, bContainer.size);
            const pItems: (ItemStack | null)[] = [];
            const bItems: (ItemStack | null)[] = [];
            for (let i = 0; i < size; i++) {
              pItems.push(pContainer.getItem(i) ?? null);
              bItems.push(bContainer.getItem(i) ?? null);
            }
            for (let i = 0; i < size; i++) {
              bContainer.setItem(i, pItems[i] ?? undefined);
              pContainer.setItem(i, bItems[i] ?? undefined);
            }
            saveCoordinator.saveInventory(r.name, collectContainerItems(bContainer));
            done.push("背包");
          }

          // ── 主手（背包未涵盖时才单独互换） ──
          if (hasMainhand && !hasInv) {
            // 闭包异步（永不 reject）：面板内 fire-and-forget，结果不阻塞后续槽位处理
            void swapMainhandWithBot(player, bot);
            done.push("主手");
          }

          // ── 副手 & 装备（头/胸/腿/靴） ──
          if (hasOffhand || hasArmor) {
            const pEquip = player.getComponent("minecraft:equippable");
            const bEquip = bot.getComponent("minecraft:equippable");
            if (pEquip && bEquip) {
              for (const slot of [EquipmentSlot.Offhand, EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
                const isOffhand = slot === EquipmentSlot.Offhand;
                if (isOffhand && !hasOffhand) continue;
                if (!isOffhand && !hasArmor) continue;
                const pItem = pEquip.getEquipment(slot);
                const bItem = bEquip.getEquipment(slot);
                pEquip.setEquipment(slot, bItem);
                bEquip.setEquipment(slot, pItem);
                // 槽位粒度装备变化事件：互换副手只触发 offhand，互换装备只触发 4 槽
                triggerEquipChangeUI(bot, slot);
              }
            }
            if (hasOffhand) done.push("副手");
            if (hasArmor) done.push("装备");
          }

          player.sendMessage(`${color.success}已与 ${color.playerName}${botName}${color.success} 互换${done.join("、")}`);
        } catch (e: any) { player.sendMessage(`${color.error}互换失败: ${e.message}`); }
      });
    });
}
