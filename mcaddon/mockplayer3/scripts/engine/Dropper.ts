// ─── 丢弃原子（选中该槽 → 丢 → 恢复原选中） ────────────────────────
// 引擎只有 dropSelectedItem()，无按槽直丢 API；成功以严格 === true 判定。
// 逐槽连着丢会触发引擎丢弃冷却与实体合并竞态，槽间强制 ≥4t（F-12）。

import type { CancelToken } from "../domain/Cancellation";
import { INVENTORY_SIZE } from "../domain/Record";
import { botOf, botValid, sleepTicks } from "./Atomic";
import { inventoryChanged } from "./Hooks";

export type DropResult = "dropped" | "empty" | "failed" | "offline";

/** 槽间节流（tick）：逐槽连着丢会触发丢弃冷却/实体合并竞态（F-12） */
const DROP_INTERVAL_TICKS = 4;

export class Dropper {
  /** 丢弃指定槽物品（选中→丢→还原三步，任何失败不抛穿） */
  dropSlot(botId: number, slot: number): DropResult {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    if (slot < 0 || slot >= INVENTORY_SIZE) return "failed";
    const restore = this.selected(bot);
    try {
      if (slot !== restore) bot.selectedSlotIndex = slot;
      const ok = bot.dropSelectedItem() === true; // truthy 不等于成功，须严格判定
      if (!ok) return "empty"; // 丢不动≈槽空/堆叠拒绝——引擎无区分面
      inventoryChanged(botId);
      return "dropped";
    } catch {
      return "offline";
    } finally {
      this.keepSelected(bot, restore); // 主手原位（异常也要还原）
    }
  }

  /**
   * 逐槽清空（背包 0..35 顺序扫；每槽后节流等待）。
   * @returns 成功丢弃槽数
   */
  async dropInventory(botId: number, opts: { intervalTicks?: number; token?: CancelToken } = {}): Promise<number> {
    const interval = Math.max(DROP_INTERVAL_TICKS, opts.intervalTicks ?? DROP_INTERVAL_TICKS);
    let dropped = 0;
    for (let slot = 0; slot < INVENTORY_SIZE; slot++) {
      if (opts.token?.cancelled) break;
      const r = this.dropSlot(botId, slot);
      if (r === "offline") break;
      if (r === "dropped") dropped++;
      await sleepTicks(interval, opts.token);
    }
    return dropped;
  }

  // ─── 私有 ──

  private selected(bot: { selectedSlotIndex: number }): number {
    try {
      return bot.selectedSlotIndex;
    } catch {
      return 0;
    }
  }

  private keepSelected(bot: { selectedSlotIndex: number }, slot: number): void {
    try {
      bot.selectedSlotIndex = slot;
    } catch {
      /* 还原失败无世界后果（下 tick 由对账修正） */
    }
  }
}

/** 进程级单例 */
export const dropper = new Dropper();
