// ─── 丢弃物品面板 ────────────────────────────────────
// 面板按钮只发布 panelAction（ui/bot.ts），本文件订阅 discard 动作 → 弹表单 → 提交后以掉落物形式丢弃。

import { Player, EquipmentSlot, system, world } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { BotUiEvent } from "../../../events/UiEvents";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { inventoryContainerOf } from "../../../features/basic/items/ItemComponentRead";
import { dropSelectedItem } from "../../../features/basic/items/drop";
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
    const slot = (bot as any).selectedSlotIndex ?? 0;
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
    const comp = (bot as any).getComponent("minecraft:equippable");
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
      system.run(async () => {
        try {
          const bot = resolveBotPlayer(botName) as any;
          if (!bot) { player.sendMessage(`${color.error}假人不在线`); return; }
          const container = inventoryContainerOf(bot);
          const equippable = bot.getComponent("minecraft:equippable") as any;
          if (!container) { player.sendMessage(`${color.error}无法获取背包`); return; }

          const originalSelectedSlot: number = bot.selectedSlotIndex ?? 0;
          const originalMainhandItem = container.getItem(originalSelectedSlot);

          const slotsToDrop = new Set<number>();
          if (vals.mainhand) slotsToDrop.add(originalSelectedSlot);
          if (vals.hotbar) for (let i = 0; i < 9; i++) slotsToDrop.add(i);
          if (vals.backpack) for (let i = 9; i < 36; i++) slotsToDrop.add(i);

          const equipSlots: EquipmentSlot[] = [];
          if (vals.offhand) equipSlots.push(EquipmentSlot.Offhand);
          if (vals.head) equipSlots.push(EquipmentSlot.Head);
          if (vals.chest) equipSlots.push(EquipmentSlot.Chest);
          if (vals.legs) equipSlots.push(EquipmentSlot.Legs);
          if (vals.feet) equipSlots.push(EquipmentSlot.Feet);

          const containsMainhand = slotsToDrop.has(originalSelectedSlot);
          // 不含主手时暂存主手，丢完后恢复
          let savedMainhand: any = null;
          if (!containsMainhand && originalMainhandItem) {
            savedMainhand = originalMainhandItem;
          }
          // slot0 暂存（若 slot0 不在丢弃集合，避免被覆盖丢失）
          let savedSlot0: any = null;
          let hasSavedSlot0 = false;
          if (!slotsToDrop.has(0)) {
            savedSlot0 = container.getItem(0);
            hasSavedSlot0 = !!savedSlot0;
          }

          bot.selectedSlotIndex = 0;
          let cleared = 0;
          const waitTicks = (ticks: number): Promise<void> => new Promise<void>(r => system.runTimeout(r, ticks));

          // 统一丢弃序列：先背包槽位，再装备槽位，只用一个 while 循环
          type DropOp = { kind: "inv"; slot: number } | { kind: "equip"; slot: EquipmentSlot };
          const ops: DropOp[] = [];
          for (const s of [...slotsToDrop].sort((a, b) => a - b)) ops.push({ kind: "inv", slot: s });
          for (const s of equipSlots) ops.push({ kind: "equip", slot: s });

          const needWait = ops.length > 1;
          let idx = 0;
          while (idx < ops.length) {
            const op = ops[idx];
            if (op.kind === "inv") {
              const slot = op.slot;
              const item = container.getItem(slot);
              if (item) {
                if (slot === 0) {
                  if (dropSelectedItem(botName)) cleared++;
                  else {
                    try { bot.dimension.spawnItem(item, bot.location); container.setItem(0, undefined); cleared++; } catch {}
                  }
                } else {
                  const curSelected = container.getItem(0);
                  container.setItem(0, item);
                  container.setItem(slot, curSelected ?? undefined);
                  if (dropSelectedItem(botName)) {
                    cleared++;
                  } else {
                    try { bot.dimension.spawnItem(item, bot.location); container.setItem(0, curSelected ?? undefined); cleared++; } catch {
                      container.setItem(slot, item);
                      container.setItem(0, curSelected ?? undefined);
                    }
                  }
                }
              }
            } else {
              const eqSlot = op.slot;
              const item = (() => { try { return equippable?.getEquipment(eqSlot); } catch { return undefined; } })();
              if (item) {
                try { equippable.setEquipment(eqSlot, undefined); } catch {}
                const cur = container.getItem(0);
                container.setItem(0, item as any);
                if (dropSelectedItem(botName)) {
                  cleared++;
                } else {
                  try { bot.dimension.spawnItem(item as any, bot.location); container.setItem(0, cur ?? undefined); cleared++; } catch {
                    container.setItem(0, cur ?? undefined);
                    try { equippable.setEquipment(eqSlot, item); } catch {}
                  }
                }
              }
            }
            idx++;
            if (needWait && idx < ops.length) await waitTicks(3);
          }

          if (!containsMainhand && savedMainhand) {
            try {
              if (originalSelectedSlot === 0) {
                if (!container.getItem(0)) container.setItem(0, savedMainhand);
              } else {
                if (!container.getItem(originalSelectedSlot)) container.setItem(originalSelectedSlot, savedMainhand);
              }
              bot.selectedSlotIndex = originalSelectedSlot;
            } catch {}
          } else if (hasSavedSlot0 && savedSlot0 && !container.getItem(0)) {
            try { container.setItem(0, savedSlot0); } catch {}
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
