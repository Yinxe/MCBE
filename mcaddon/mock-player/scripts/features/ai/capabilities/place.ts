// ─── 自动放置能力（新框架 scripts/ai：Behavior 状态机） ──
// 用户拍板：自动放置做成生物 AI 行为（简单能力）。
// 逻辑（对齐旧标签行为）：startBuild/stopBuild 放置主手方块到面前；
// 每 3 个引擎周期（30 tick）放一次——不连续猛放。

import type { Behavior, BehaviorContext } from "../../../ai";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/** 放置间隔（引擎周期 = 10 tick：每 3 周期放一次） */
const PLACE_INTERVAL = 3;

/** 创建自动放置行为（record.aiBehavior === "place" 时由引擎注册） */
export function makePlaceBehavior(): Behavior {
  let tick = 0;

  return {
    name: "place",
    priority: 10,
    canActivate: () => true, // 引擎按 aiBehavior 注册/卸载，激活即运行
    reset: () => {
      tick = 0;
    },
    step: (ctx) => {
      if (++tick % PLACE_INTERVAL !== 0) return;
      const bot = resolveBotPlayer(ctx.botName);
      if (!bot) return;
      try {
        bot.stopBreakingBlock();
        bot.startBuild(0);
        bot.stopBuild();
      } catch (e: any) {
        console.warn(`[MockPlayer] 自动放置异常 ${ctx.botName}: ${e?.message ?? e}`);
      }
    },
  };
}
