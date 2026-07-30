// ─── 主手物品选择 ──────────────────────────────────────
// 扫描背包所有物品，将选中的物品置换到当前主手槽并选中

import { system } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";

import { resolveBotPlayer } from "./core/persistence";
import { formatEnchantments, formatDurability } from "./core/utils";

// ─── 公开类型 ──────────────────────────────────────────

export interface MainhandOption {
  /** 选项值: -1 = 清空, >=0 = 物品所在槽位 */
  value: number;
  /** 展示文字，如 "固定:无"、"[热栏3] 钻石剑 x32" */
  label: string;
}

// ─── 扫描背包 ──────────────────────────────────────────

/**
 * 扫描假人全部背包，生成主手选择列表。
 * 仅当背包有空位时，第一项才为"固定:无"（value = -1）。
 * @returns undefined 表示假人不可用，空数组表示背包无物品
 */
export function getMainhandOptions(botName: string): MainhandOption[] | undefined {
  const bot = resolveBotPlayer(botName);
  if (!bot) return undefined;

  const inv = bot.getComponent("minecraft:inventory") as any;
  if (!inv?.container) return [];

  const container = inv.container;
  /** 假人当前选中的热栏槽（即主手槽） */
  const handSlot = bot.selectedSlotIndex;

  const options: MainhandOption[] = [];

  // 检查是否有空位可移除主手物品 — 无空位时不显示"清空"选项
  for (let i = 0; i < container.size; i++) {
    if (i !== handSlot && !container.getItem(i)) {
      options.push({ value: -1, label: style("固定:无", color.darkGray) });
      break;
    }
  }

  for (let i = 0; i < container.size; i++) {
    // 排除当前主手槽（已充为主手物品，不展示在列表中）
    if (i === handSlot) continue;
    const item = container.getItem(i);
    if (!item) continue;

    const slotLabel = i < 9
      ? `热栏${i + 1}`
      : `背包${i + 1}`;
    const slotTag = i < 9 ? color.gold : color.black;

    let label: string;
    try {
      const displayName = item.nameTag || item.typeId.replace("minecraft:", "");
      const enchStr = formatEnchantments(item);
      const durStr = formatDurability(item);
      const amount = item.amount > 1 ? ` ${color.darkGray}x${item.amount}` : "";

      label = `${slotTag}[${slotLabel}] ${color.black}${displayName}${amount}`
        + (durStr ? ` ${durStr}` : "")
        + (enchStr ? `\n ${enchStr}` : "");
    } catch {
      label = `${slotTag}[${slotLabel}] ${color.darkGray}<解析失败>`;
    }
    options.push({ value: i, label });
  }

  return options;
}

// ─── 设置主手 ──────────────────────────────────────────

/**
 * 将指定槽位的物品置换到 slot 0 并选中。
 * @param value -1 表示清空主手，>=0 表示物品所在槽位
 */
export function setMainhandSlot(botName: string, slotValue: number): void {
  const bot = resolveBotPlayer(botName);
  if (!bot) return;

  const inv = bot.getComponent("minecraft:inventory") as any;
  if (!inv?.container) return;
  const container = inv.container;

  system.run(() => {
    try {
      const handSlot = bot.selectedSlotIndex;
      if (slotValue === -1) {
        // 清空主手：先移到背包首个空位，防止吞物
        for (let i = 0; i < container.size; i++) {
          if (i !== handSlot && !container.getItem(i)) {
            container.swapItems(handSlot, i);
            break;
          }
        }
      } else if (slotValue >= 0 && slotValue < container.size && slotValue !== handSlot) {
        // 交换当前主手和目标槽
        const currentMainhand = container.getItem(handSlot);
        const targetItem = container.getItem(slotValue);
        container.setItem(slotValue, currentMainhand ?? undefined);
        container.setItem(handSlot, targetItem);
      }
      bot.selectedSlotIndex = handSlot;
    } catch {
      // 操作失败时忽略
    }
  });
}

