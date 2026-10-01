// ─── 工具耐久守护（库存事件驱动；告急时换健康件或保护性收起） ────────
// 触发源 PlayerInventoryItemChangeAfterEvent：耐久变化也触发该事件，须过三道闸：
// changedSlot===当前选中槽（只看主手）；60t 冷却（换械本身再触发事件，不冷却即递归风暴）；
// 关注白名单 + 告急双线（<5% 或剩余<10）。
// 动作：有同型健康件走 planGuardSwap（candidate===主手槽时只切选中，禁止 swap(0,0)
// 自交换把受损件留主手）；无替换则 pickStowSlot 收起（手≠0 时目标绝不选 0）。
// 事后选中槽回固定主手位 0；播报/落盘经 Hooks 外发，本层零日志。

import type { ItemStack } from "@minecraft/server";
import { INVENTORY_SIZE } from "../domain/Record";
import {
  findReplacementIndex,
  isDurabilityCritical,
  isWatchedTool,
  pickStowSlot,
  planGuardSwap,
  slotLabel,
  GUARD_MAINHAND_SLOT,
} from "../domain/ToolRules";
import type { DurabilitySnapshot } from "../domain/ToolRules";
import { botOf, botValid, inventoryContainer } from "./Atomic";
import { clock } from "./Clock";
import { wielder } from "./Wielder";
import { inventoryChanged, toolGuardFired } from "./Hooks";

/** 守护冷却（tick）：换械再触发事件，不冷却即递归风暴 */
const GUARD_COOLDOWN_TICKS = 60;

export class ToolGuard {
  private readonly lastFired = new Map<number, number>();

  /** Bridges 转发的库存变化入口（异常隔离：事件风暴绝不瘫痪世界回调） */
  onInventoryChanged(botId: number, changedSlot: number): void {
    try {
      this.guard(botId, changedSlot);
    } catch (e: any) {
      console.error(`[mockplayer3] 工具守护异常 bot=${botId}: ${e?.message ?? e}`);
    }
  }

  /** 会话销毁时清除该假人的冷却记录 */
  forget(botId: number): void {
    this.lastFired.delete(botId);
  }

  // ─── 私有 ──

  private guard(botId: number, changedSlot: number): void {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return;
    const hand = this.selected(bot);
    if (changedSlot !== hand) return; // 只看主手
    const now = clock.now();
    const last = this.lastFired.get(botId);
    if (last !== undefined && now - last < GUARD_COOLDOWN_TICKS) return;
    const container = inventoryContainer(bot);
    if (!container) return;
    const item = container.getItem(hand);
    if (!item || !isWatchedTool(item.typeId)) return;
    const snap = this.durability(item);
    if (!isDurabilityCritical(snap)) return;
    this.lastFired.set(botId, now);
    const typeIds: (string | null)[] = [];
    // 候选健康闸：只比 typeId 会换上另一残件并在 60t 内反复触发——候选必须健康
    const durabilities: (DurabilitySnapshot | null)[] = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const it = container.getItem(i);
      typeIds.push(it?.typeId ?? null);
      durabilities.push(it ? this.durability(it) : null);
    }
    const remaining =
      snap.maxDurability !== undefined && snap.damage !== undefined ? snap.maxDurability - snap.damage : undefined;
    const durText =
      remaining !== undefined && snap.maxDurability !== undefined
        ? `耐久${remaining}/${snap.maxDurability}`
        : "耐久告急";
    const candidate = findReplacementIndex(typeIds, item.typeId, hand, (slot) => {
      const d = durabilities[slot];
      return d !== null && !isDurabilityCritical(d);
    });
    if (candidate >= 0) {
      const plan = planGuardSwap(hand, candidate);
      for (const [a, b] of plan.swaps) {
        if (wielder.swapSlots(botId, a, b) !== "ok") return; // 交换失败放弃本轮（下轮事件再救）
      }
      this.select(bot, GUARD_MAINHAND_SLOT);
      toolGuardFired(botId, `工具${durText}告急，已切换同型健康工具（${slotLabel(candidate)}→主手）`);
    } else {
      const stow = pickStowSlot(typeIds, hand);
      if (wielder.swapSlots(botId, hand, stow) !== "ok") return;
      this.select(bot, GUARD_MAINHAND_SLOT);
      toolGuardFired(botId, `工具${durText}且无替换，已收至${slotLabel(stow)}`);
    }
    inventoryChanged(botId);
  }

  private durability(item: ItemStack): DurabilitySnapshot {
    try {
      const dur = item.getComponent("minecraft:durability") as { damage?: number; maxDurability?: number } | undefined;
      const unbreakable = item.getComponent("minecraft:unbreakable") !== undefined;
      return { damage: dur?.damage, maxDurability: dur?.maxDurability, unbreakable };
    } catch {
      return {}; // 读不到组件=视为健康（缺失值防御）
    }
  }

  private selected(bot: { selectedSlotIndex: number }): number {
    try {
      return bot.selectedSlotIndex;
    } catch {
      return GUARD_MAINHAND_SLOT;
    }
  }

  private select(bot: { selectedSlotIndex: number }, slot: number): void {
    try {
      bot.selectedSlotIndex = slot; // 守护后固定回主手位 0（约定）
    } catch {
      /* 写失败留给下轮 */
    }
  }
}

/** 进程级单例 */
export const toolGuard = new ToolGuard();
