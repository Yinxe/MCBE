// ─── 主手物品选择 ──────────────────────────────────────
// 扫描背包所有物品，将选中的物品置换到当前主手槽并选中
// 决策（清空可行性/槽位命名）在 core/rules/items/MainhandPolicy，容器读写在这里

import { color, style } from "@yinxe/toolkit";

import { ActionError } from "../../../errors";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { formatEnchantments, formatDurability } from "../../../interaction/ui/format";
import { canClearMainhand, slotLabel } from "../../../rules/items/MainhandPolicy";
import { runActionNextTick } from "../../utils";
import { inventoryContainerOf } from "./ItemComponentRead";

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

  const container = inventoryContainerOf(bot);
  if (!container) return [];
  /** 假人当前选中的热栏槽（即主手槽） */
  const handSlot = bot.selectedSlotIndex;

  const options: MainhandOption[] = [];

  // 检查是否有空位可移除主手物品 — 无空位时不显示"清空"选项
  // 修复：若主手已为空则始终显示"固定:无"（保持为空），否则仅当有空位时显示
  const handItem = container.getItem(handSlot);
  if (!handItem || canClearMainhand(containerItemArray(container), handSlot)) {
    options.push({ value: -1, label: style("固定:无", color.darkGray) });
  }

  for (let i = 0; i < container.size; i++) {
    // 排除当前主手槽（已充为主手物品，不展示在列表中）
    if (i === handSlot) continue;
    const item = container.getItem(i);
    if (!item) continue;

    const slotTag = i < 9 ? color.gold : color.black;

    let label: string;
    try {
      const displayName = item.nameTag || item.typeId.replace("minecraft:", "");
      const enchStr = formatEnchantments(item);
      const durStr = formatDurability(item);
      const amount = item.amount > 1 ? ` ${color.darkGray}x${item.amount}` : "";

      label = `${slotTag}[${slotLabel(i)}] ${color.black}${displayName}${amount}`
        + (durStr ? ` ${durStr}` : "")
        + (enchStr ? `\n ${enchStr}` : "");
    } catch {
      label = `${slotTag}[${slotLabel(i)}] ${color.darkGray}<解析失败>`;
    }
    options.push({ value: i, label });
  }

  return options;
}

/** 容器 → 空位判定用数组（仅关心槽位是否为空） */
function containerItemArray(container: any): unknown[] {
  const arr: unknown[] = [];
  for (let i = 0; i < container.size; i++) {
    arr.push(container.getItem(i));
  }
  return arr;
}

// ─── 设置主手 ──────────────────────────────────────────

/**
 * 将指定槽位的物品置换到当前主手槽并选中。
 * 微动作：system.run 推迟到下一 tick 执行（容器读写是世界状态操作）；
 * 成功 resolve(true)，内部消化引擎异常转 ActionError；预期内的"不处理"
 * （主手已空/背包无空位无法清空/槽位无效）以 ActionError("unavailable")
 * 表达——调用方捕获后向玩家转述原因（物品保留在原槽，绝不吞物品）。
 * @param slotValue -1 表示清空主手，>=0 表示物品所在槽位
 * @returns 成功 resolve(true)
 * @throws ActionError 假人不可用（offline）/ 背包不可读或引擎写失败
 *   （unavailable/failed）/ 无法清空（unavailable：主手已空或背包无空位）
 */
export function setMainhandSlot(botName: string, slotValue: number): Promise<boolean> {
  return runActionNextTick(() => {
    const bot = resolveBotPlayer(botName);
    if (!bot) throw new ActionError("offline", `假人 ${botName} 不在线，无法切换主手`);
    const container = inventoryContainerOf(bot);
    if (!container) throw new ActionError("unavailable", `假人 ${botName} 背包不可读`);

    const handSlot = bot.selectedSlotIndex;
    if (slotValue === -1) {
      // 清空主手：主手物品与背包第一个空位互换；无空位则不处理（保留主手物品，绝不吞物品）
      const handItem = container.getItem(handSlot);
      if (!handItem) throw new ActionError("unavailable", "主手本就为空，无需清空");
      for (let i = 0; i < container.size; i++) {
        if (i !== handSlot && !container.getItem(i)) {
          container.setItem(i, handItem);
          container.setItem(handSlot, undefined);
          bot.selectedSlotIndex = handSlot;
          return;
        }
      }
      // 背包无空位：不做处理（物品保留在主手）
      throw new ActionError("unavailable", "背包没有空位，无法清空主手（物品已保留）");
    } else if (slotValue >= 0 && slotValue < container.size && slotValue !== handSlot) {
      // 交换当前主手和目标槽
      const currentMainhand = container.getItem(handSlot);
      const targetItem = container.getItem(slotValue);
      container.setItem(slotValue, currentMainhand ?? undefined);
      container.setItem(handSlot, targetItem);
      bot.selectedSlotIndex = handSlot;
      return;
    }
    throw new ActionError("unavailable", `无效的主手槽位: ${slotValue}`);
  }, `假人 ${botName} 切换主手失败`);
}