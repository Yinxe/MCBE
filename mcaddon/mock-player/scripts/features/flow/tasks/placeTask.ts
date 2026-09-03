// ─── 定点放置任务（timed：阶段机） ──────────────────────
// workMode="place"。单阶段循环：解析实体 → 放置主手方块（面前）→ 间隔等待。
// 放置冲突/主手无方块等瞬态失败就地 warn（可见），下一轮自然重试；
// 意外异常由骨架统一退避（连续失败达上限终止任务）。

import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { placeBlockOnce } from "../../basic/blocks";
import { defineLoopTask, warnTaskError } from "./spec";

/** 放置间隔（tick） */
const PLACE_INTERVAL_TICKS = 4;
/** 实体瞬态不可用重探间隔（tick） */
const IDLE_RECHECK_TICKS = 10;

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
