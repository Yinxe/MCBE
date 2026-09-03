// ─── 定点放置任务（timed：阶段机 + 主手方块自动补位） ──
// workMode="place"。单阶段循环：解析实体 → 确保主手可放置（主手空/不可
// 放置 → 从背包找第一个可放置方块换上；背包也没有 → 低息等待）→ 放置
// 主手方块（面前）→ 间隔等待。放置冲突/主手无方块等瞬态失败就地 warn
// （可见），下一轮自然重试；意外异常由骨架统一退避（连续失败达上限终止）。
//
// 可放置判定：BlockTypes.get(typeId) 存在（物品 id 与方块 id 同名即可放）。

import { BlockTypes } from "@minecraft/server";

import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { placeBlockOnce } from "../../basic/blocks";
import { inventoryContainerOf } from "../../basic/items/ItemComponentRead";
import { setMainhandSlot } from "../../basic/items/mainhand";
import { defineLoopTask, warnTaskError } from "./spec";

/** 放置间隔（tick） */
const PLACE_INTERVAL_TICKS = 4;
/** 实体瞬态不可用/背包无方块重查间隔（tick） */
const IDLE_RECHECK_TICKS = 10;

/** 物品 typeId 是否可放置（物品 id 与方块 id 同名 → 该物品能变成方块） */
function isPlaceableItem(typeId: string): boolean {
  return BlockTypes.get(typeId) !== undefined;
}

/**
 * 确保主手是可放置方块：
 * - 主手已有可放置物品 → 不折腾；
 * - 主手空/不可放置 → 背包找第一个可放置方块换上；
 * - 背包也没有可放置方块 → 返回 false（调用方低息等待）。
 */
async function ensurePlaceableMainhand(botName: string): Promise<boolean> {
  const bot = resolveBotPlayer(botName);
  const container = bot ? inventoryContainerOf(bot) : undefined;
  if (!bot || !container) return false;

  const handItem = container.getItem(bot.selectedSlotIndex);
  if (handItem && isPlaceableItem(handItem.typeId)) return true; // 主手可放置

  // 找背包里第一个可放置方块（跳过主手槽——setMainhandSlot 语义即交换）
  for (let slot = 0; slot < container.size; slot++) {
    if (slot === bot.selectedSlotIndex) continue;
    const item = container.getItem(slot);
    if (item && isPlaceableItem(item.typeId)) {
      try {
        await setMainhandSlot(botName, slot);
        return true;
      } catch {
        return false; // 换装失败（背包被占等）→ 本轮放弃
      }
    }
  }
  return false;
}

/** 定点放置（定时循环）任务 */
export const placeTask = defineLoopTask<void>({
  workMode: "place",
  kind: "timed",
  label: "定点放置",
  createData: () => undefined,
  initial: "place",
  phases: {
    place: {
      label: "放置",
      run: async (ctx) => {
        const bot = resolveBotPlayer(ctx.botName);
        if (!bot) {
          await ctx.wait(IDLE_RECHECK_TICKS);
          return "place";
        }
        // 主手方块自动补位：主手非可放置 → 从背包换上；无方块可换 → 低息等待
        if (!(await ensurePlaceableMainhand(ctx.botName))) {
          ctx.notify("背包没有可放置的方块，等待补充");
          await ctx.wait(IDLE_RECHECK_TICKS);
          return "place";
        }
        try {
          await placeBlockOnce(bot);
        } catch (e: unknown) {
          // 放置失败可见（主手无方块引擎静默无效果不抛；此处为引擎异常）
          warnTaskError(`定点放置失败 ${ctx.botName}`, e);
        }
        await ctx.wait(PLACE_INTERVAL_TICKS);
        return "place";
      },
    },
  },
});
