// ─── 主手原子（置换与清空，双 setItem 互换） ──────────────────────────
// 绝不 setItem(undefined) 覆盖有物方；清空主手须有非主手空位承接，无空位拒绝——宁留主手不丢物。
// 写完回读两槽指纹 + 报脏。主手槽=当前 selectedSlot（"固定槽0"约定在 ToolGuard 侧表达）。
// 交换后选中槽写回主手槽：部分版本 setItem 会触发热栏漂移，属防御动作。

import type { ItemStack } from "@minecraft/server";
import { INVENTORY_SIZE } from "../domain/Record";
import type { SlotDigest } from "../domain/Fingerprint";
import { botOf, botValid, inventoryContainer } from "./Atomic";
import { inventoryChanged } from "./Hooks";

/** 主手设置结果（槽位 -1 = 清空主手语义） */
export type WieldResult =
  "ok" | "empty-hand" | "no-space" | "same-slot" | "bad-slot" | "offline" | "no-container" | "verify-failed";

function digest(item: ItemStack | undefined): SlotDigest | null {
  return item ? { typeId: item.typeId, amount: item.amount } : null;
}

function sameDigest(a: SlotDigest | null, b: SlotDigest | null): boolean {
  if (!a || !b) return a === b || (!a && !b);
  return a.typeId === b.typeId && a.amount === b.amount;
}

export class Wielder {
  /** 当前主手物品类型（离线/空手 undefined——能力层选靶探测用） */
  heldTypeId(botId: number): string | undefined {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return undefined;
    const container = inventoryContainer(bot);
    if (!container) return undefined;
    try {
      return container.getItem(bot.selectedSlotIndex)?.typeId;
    } catch {
      return undefined;
    }
  }

  /**
   * 把 slotValue 槽的物品置换进主手并选中；-1=清空主手。
   * @param slotValue - -1 清空；>=0 物品所在槽位
   */
  setMainhand(botId: number, slotValue: number): WieldResult {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    const container = inventoryContainer(bot);
    if (!container) return "no-container";
    const handSlot = this.safeSelectedSlot(bot);
    if (slotValue === -1) {
      const handItem = container.getItem(handSlot);
      if (!handItem) return "empty-hand";
      const empty = findEmptyExcept(container, handSlot);
      if (empty === -1) return "no-space"; // 无空位承接——绝不吞物品
      container.setItem(empty, handItem);
      container.setItem(handSlot, undefined);
      this.keepSelection(bot, handSlot);
      const ok = sameDigest(digest(container.getItem(empty)), digest(handItem)) && !container.getItem(handSlot);
      if (!ok) return "verify-failed";
      inventoryChanged(botId);
      return "ok";
    }
    if (slotValue < 0 || slotValue >= INVENTORY_SIZE) return "bad-slot";
    if (slotValue === handSlot) return "same-slot";
    const handItem = container.getItem(handSlot);
    const targetItem = container.getItem(slotValue);
    if (!targetItem) return "empty-hand"; // 目标槽空——交换无意义（清空请走 -1）
    // 双 setItem 互换（顺序：先写主手入目标槽——失败时目标原物仍在主手位可恢复）
    container.setItem(slotValue, handItem ?? undefined);
    container.setItem(handSlot, targetItem);
    this.keepSelection(bot, handSlot);
    const ok =
      sameDigest(digest(container.getItem(handSlot)), digest(targetItem)) &&
      sameDigest(digest(container.getItem(slotValue)), digest(handItem));
    if (!ok) return "verify-failed";
    inventoryChanged(botId);
    return "ok";
  }

  /**
   * 任意两槽互换（工具守卫计划执行原语——domain planGuardSwap 产出槽对）。
   * 同槽/越界/双方皆空视为无效请求；写完回读双槽指纹。
   */
  swapSlots(botId: number, a: number, b: number): WieldResult {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    if (a === b) return "same-slot";
    if (a < 0 || b < 0 || a >= INVENTORY_SIZE || b >= INVENTORY_SIZE) return "bad-slot";
    const container = inventoryContainer(bot);
    if (!container) return "no-container";
    const handSlot = this.safeSelectedSlot(bot);
    const itemA = container.getItem(a);
    const itemB = container.getItem(b);
    container.setItem(b, itemA ?? undefined);
    container.setItem(a, itemB ?? undefined);
    this.keepSelection(bot, handSlot);
    const ok =
      sameDigest(digest(container.getItem(a)), digest(itemB)) &&
      sameDigest(digest(container.getItem(b)), digest(itemA));
    if (!ok) return "verify-failed";
    inventoryChanged(botId);
    return "ok";
  }

  // ─── 私有 ──

  /** 选中槽读取防御（瞬态异常按槽 0 处理——主手约定兜底） */
  private safeSelectedSlot(bot: { selectedSlotIndex: number }): number {
    try {
      const s = bot.selectedSlotIndex;
      return s >= 0 && s < INVENTORY_SIZE ? s : 0;
    } catch {
      return 0;
    }
  }

  private keepSelection(bot: { selectedSlotIndex: number }, slot: number): void {
    try {
      bot.selectedSlotIndex = slot;
    } catch {
      /* 写入失败不翻转交换结果——物品位置是真载荷 */
    }
  }
}

function findEmptyExcept(
  container: { size: number; getItem(i: number): ItemStack | undefined },
  except: number
): number {
  for (let i = 0; i < Math.min(container.size, INVENTORY_SIZE); i++) {
    if (i === except) continue;
    if (!container.getItem(i)) return i;
  }
  return -1;
}

/** 进程级单例 */
export const wielder = new Wielder();
