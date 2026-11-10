// ─── 使用/进食原子（按下-松开配对） ────────────────────────────────
// useItemInSlot(选中槽) → 时长档等待 → stopUsingItem；弓类不轮询冷却。
// F-16：时长档常规 40t、食物 80t——中途 stopUsingItem 取消进食，食物 40t 过短。
// 引擎事实：hunger 或 saturation ≥19.5 时进食无效，直接拒绝。
// 组件 id 用点式 'minecraft:player.hunger'（现版本下划线写法不可见）。
// 全程永不 reject；isValid 在按下前与松开前双查（失效实体抛穿）。

import type { CancelToken } from "../domain/Cancellation";
import { INVENTORY_SIZE } from "../domain/Record";
import { botOf, botValid, inventoryContainer, sleepTicks } from "./Atomic";

/** 语义时长档；具体 tick 数归本模块时序 */
export type ConsumeTier = "generic" | "food";

/** 每档按住时长（tick） */
export const CONSUME_DURATION: Record<ConsumeTier, number> = {
  generic: 40,
  food: 80,
};

/** 拒食阈值：≥19.5 引擎侧进食无效 */
const FULL_THRESHOLD = 19.5;

export type ConsumeResult = "consumed" | "full" | "no-item" | "no-effect" | "aborted" | "offline" | "no-container";

export class Consumer {
  /** 食物组件在场探测（能力层选槽/判定用；item 由调用方给 typeId 无法判 NBT 语义，走引擎组件） */
  isFood(botId: number, slot: number): boolean {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return false;
    const item = inventoryContainer(bot)?.getItem(slot);
    if (!item) return false;
    try {
      return item.getComponent("minecraft:food") !== undefined;
    } catch {
      return false;
    }
  }

  /** 饱食判定（组件不可读按未饱和处理——放行比饿死好） */
  isFullyFed(botId: number): boolean {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return false;
    return (
      this.readStat(bot, "minecraft:player.hunger") >= FULL_THRESHOLD ||
      this.readStat(bot, "minecraft:player.saturation") >= FULL_THRESHOLD
    );
  }

  /**
   * 使用一次当前选中物品；选中槽空则回退热栏第一个有物槽。
   * @param botId 假人句柄
   * @param tier 时长档（generic/food）
   * @param token 可选取消令牌
   * @returns 使用结果枚举，不抛穿
   */
  async consume(botId: number, tier: ConsumeTier = "generic", token?: CancelToken): Promise<ConsumeResult> {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    const container = inventoryContainer(bot);
    if (!container) return "no-container";
    let slot: number;
    try {
      slot = this.findUsableSlot(bot, container);
    } catch {
      return "offline";
    }
    if (slot < 0 || !container.getItem(slot)) return "no-item";
    if (tier === "food" && this.isFullyFed(botId)) return "full";
    try {
      if (!bot.useItemInSlot(slot)) return "no-effect";
    } catch {
      return "offline"; // 按下即句柄失效
    }
    const cancelled = await this.hold(tier, token);
    // 松开前二次有效性回读（失效实体抛穿）
    const fresh = botOf(botId);
    if (!fresh || !botValid(fresh)) return "offline";
    try {
      fresh.stopUsingItem();
    } catch {
      /* 松开失败：引擎侧使用态自会超时终止，不翻转结果 */
    }
    return cancelled ? "aborted" : "consumed";
  }

  // ─── 私有 ──

  /** 等待时长档；token 取消提前唤醒并报告（松开仍会执行） */
  private async hold(tier: ConsumeTier, token?: CancelToken): Promise<boolean> {
    if (!token) {
      await sleepTicks(CONSUME_DURATION[tier]);
      return false;
    }
    const woke = await Promise.race([
      sleepTicks(CONSUME_DURATION[tier]).then(() => "time" as const),
      token.signal.then(() => "cancel" as const),
    ]);
    return woke === "cancel";
  }

  private readStat(
    bot: ReturnType<typeof botOf>,
    id: "minecraft:player.hunger" | "minecraft:player.saturation"
  ): number {
    try {
      return (bot?.getComponent(id) as { value?: number } | undefined)?.value ?? -1;
    } catch {
      return -1;
    }
  }

  /** 选中槽有物用选中；否则热栏第一个有物；全无返回 -1 */
  private findUsableSlot(bot: { selectedSlotIndex: number }, container: { getItem(i: number): unknown }): number {
    const selected = bot.selectedSlotIndex;
    if (selected >= 0 && selected < INVENTORY_SIZE && container.getItem(selected)) return selected;
    for (let i = 0; i < 9; i++) {
      if (container.getItem(i)) return i;
    }
    return -1;
  }
}

/** 进程级单例 */
export const consumer = new Consumer();
