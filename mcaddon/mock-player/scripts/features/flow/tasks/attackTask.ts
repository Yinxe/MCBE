// ─── 定点攻击任务（timed：阶段机） ──────────────────────
// workMode="attack"。单阶段循环：解析实体 → 攻击面前目标（引擎 attack()）→
// 间隔等待。面前无目标等瞬态失败就地 warn（可见），下一轮自然重试。

import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { defineLoopTask, warnTaskError } from "./spec";

/** 攻击间隔（tick） */
const ATTACK_INTERVAL_TICKS = 4;
/** 实体瞬态不可用重探间隔（tick） */
const IDLE_RECHECK_TICKS = 10;

/** 定点攻击（定时循环）任务 */
export const attackTask = defineLoopTask<void>({
  workMode: "attack",
  kind: "timed",
  label: "定点攻击",
  createData: () => undefined,
  initial: "attack",
  phases: {
    attack: {
      label: "攻击",
      run: async (ctx) => {
        const bot = resolveBotPlayer(ctx.botName);
        if (!bot) {
          await ctx.wait(IDLE_RECHECK_TICKS);
          return "attack";
        }
        try {
          bot.attack();
        } catch (e: unknown) {
          // 面前无目标/目标不可打时引擎可能抛错——可见但不中断任务
          warnTaskError(`定点攻击失败 ${ctx.botName}`, e);
        }
        await ctx.wait(ATTACK_INTERVAL_TICKS);
        return "attack";
      },
    },
  },
});
