// ─── 丢弃物品面板 ────────────────────────────────────
// 面板按钮只发布 panelAction（ui/bot.ts），本文件订阅 discard 动作 → 弹表单 → 提交后直接丢弃。

import { Player, EquipmentSlot, system, world } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { BotUiEvent } from "../../../events/UiEvents";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { inventoryContainerOf } from "../../../features/basic/items/ItemComponentRead";
import { resolveUiBotRecord } from "../helpers";

// ─── UI 事件订阅 ──────────────────────────────────────

/** 订阅 BOT 主菜单动作事件：丢弃物品 → 弹表单 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "discard") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    showDiscardForm(player, e.botName);
  });
}

// ─── 工具 ──────────────────────────────────────────────

function getMainhandInfo(botName: string): string {
  const bot = resolveBotPlayer(botName);
  if (!bot) return `${color.muted}空`;
  try {
    const container = inventoryContainerOf(bot);
    if (!container) return `${color.muted}空`;
    const slot = bot.selectedSlotIndex;
    const item = container.getItem(slot);
    if (!item) return `${color.muted}空`;
    return `${color.playerName}${item.typeId.replace("minecraft:", "")} x${item.amount}`;
  } catch { return `${color.muted}空`; }
}

function getHotbarInfo(botName: string): string {
  const bot = resolveBotPlayer(botName);
  if (!bot) return `${color.muted}0/9`;
  try {
    const container = inventoryContainerOf(bot);
    if (!container) return `${color.muted}0/9`;
    let count = 0;
    for (let i = 0; i < 9; i++) if (container.getItem(i)) count++;
    return count === 0 ? `${color.muted}空 (0/9)` : `${color.info}${count}/9 格有物品`;
  } catch { return `${color.muted}0/9`; }
}

function getBackpackInfo(botName: string): string {
  const bot = resolveBotPlayer(botName);
  if (!bot) return `${color.muted}0/27`;
  try {
    const container = inventoryContainerOf(bot);
    if (!container) return `${color.muted}0/27`;
    let count = 0;
    for (let i = 9; i < 36; i++) if (container.getItem(i)) count++;
    return count === 0 ? `${color.muted}空 (0/27)` : `${color.info}${count}/27 格有物品`;
  } catch { return `${color.muted}0/27`; }
}

function getEquipmentInfo(botName: string, slot: EquipmentSlot): string {
  const bot = resolveBotPlayer(botName);
  if (!bot) return `${color.muted}空`;
  try {
    const comp = bot.getComponent("minecraft:equippable") as any;
    if (!comp) return `${color.muted}空`;
    const item = comp.getEquipment(slot);
    if (!item) return `${color.muted}空`;
    return `${color.playerName}${item.typeId.replace("minecraft:", "")} x${item.amount ?? 1}`;
  } catch { return `${color.muted}空`; }
}

// ─── 表单 ──────────────────────────────────────────────

export function showDiscardForm(player: Player, botName: string): void {
  const mainhandInfo = getMainhandInfo(botName);
  const hotbarInfo = getHotbarInfo(botName);
  const backpackInfo = getBackpackInfo(botName);
  const offhandInfo = getEquipmentInfo(botName, EquipmentSlot.Offhand);
  const headInfo = getEquipmentInfo(botName, EquipmentSlot.Head);
  const chestInfo = getEquipmentInfo(botName, EquipmentSlot.Chest);
  const legsInfo = getEquipmentInfo(botName, EquipmentSlot.Legs);
  const feetInfo = getEquipmentInfo(botName, EquipmentSlot.Feet);

  new ModalFormBuilder()
    .title(`${color.bold}丢弃物品 · ${botName}`)
    .label("hint", `${color.muted}勾选需要丢弃的槽位，提交后以掉落物形式丢出`)
    .toggle("mainhand", `主手: ${mainhandInfo}`, { defaultValue: false })
    .toggle("hotbar", `热栏: ${hotbarInfo}`, { defaultValue: false })
    .toggle("backpack", `背包: ${backpackInfo}`, { defaultValue: false })
    .toggle("offhand", `副手: ${offhandInfo}`, { defaultValue: false })
    .toggle("head", `头盔: ${headInfo}`, { defaultValue: false })
    .toggle("chest", `胸甲: ${chestInfo}`, { defaultValue: false })
    .toggle("legs", `护腿: ${legsInfo}`, { defaultValue: false })
    .toggle("feet", `靴子: ${feetInfo}`, { defaultValue: false })
    .submitButton("丢弃")
    .show(player)
    .then((vals) => {
      if (!vals) return;
      const record = resolveUiBotRecord(player, botName);
      if (!record) return;
      system.run(() => {
        try {
          const bot = resolveBotPlayer(botName);
          if (!bot) { player.sendMessage(`${color.error}假人不在线`); return; }
          let cleared = 0;
          const container = inventoryContainerOf(bot);
          const equippable = bot.getComponent("minecraft:equippable") as any;
          const dim = bot.dimension;
          const loc = bot.location;

          const trySpawn = (item: any): void => {
            try { dim.spawnItem(item, loc); } catch {}
          };

          if (vals.mainhand && container) {
            const slot = bot.selectedSlotIndex;
            const item = container.getItem(slot);
            if (item) { trySpawn(item); container.setItem(slot, undefined); cleared++; }
          }
          if (vals.hotbar && container) {
            for (let i = 0; i < 9; i++) {
              // 主手已在上面丢过则跳过，避免重复掉落
              if (vals.mainhand && i === (bot as any).selectedSlotIndex) continue;
              const item = container.getItem(i);
              if (item) { trySpawn(item); container.setItem(i, undefined); cleared++; }
            }
          }
          if (vals.backpack && container) {
            for (let i = 9; i < 36; i++) {
              const item = container.getItem(i);
              if (item) { trySpawn(item); container.setItem(i, undefined); cleared++; }
            }
          }
          if (vals.offhand && equippable) {
            const item = equippable.getEquipment(EquipmentSlot.Offhand);
            if (item) { trySpawn(item); equippable.setEquipment(EquipmentSlot.Offhand, undefined); cleared++; }
          }
          if (vals.head && equippable) {
            const item = equippable.getEquipment(EquipmentSlot.Head);
            if (item) { trySpawn(item); equippable.setEquipment(EquipmentSlot.Head, undefined); cleared++; }
          }
          if (vals.chest && equippable) {
            const item = equippable.getEquipment(EquipmentSlot.Chest);
            if (item) { trySpawn(item); equippable.setEquipment(EquipmentSlot.Chest, undefined); cleared++; }
          }
          if (vals.legs && equippable) {
            const item = equippable.getEquipment(EquipmentSlot.Legs);
            if (item) { trySpawn(item); equippable.setEquipment(EquipmentSlot.Legs, undefined); cleared++; }
          }
          if (vals.feet && equippable) {
            const item = equippable.getEquipment(EquipmentSlot.Feet);
            if (item) { trySpawn(item); equippable.setEquipment(EquipmentSlot.Feet, undefined); cleared++; }
          }

          if (cleared === 0) {
            player.sendMessage(`${color.warn}没有可丢弃的物品`);
          } else {
            player.sendMessage(`${color.success}已丢出 ${color.info}${cleared}${color.success} 个槽位的物品为掉落物`);
          }
        } catch (e: any) {
          player.sendMessage(`${color.error}丢弃失败: ${e.message}`);
        }
      });
    });
}
