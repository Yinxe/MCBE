// ─── 自动放置能力（新框架 scripts/ai：Behavior 状态机） ──
// 用户拍板：自动放置做成生物 AI 行为（简单能力）。
// 逻辑（对齐旧标签行为）：startBuild/stopBuild 放置主手方块到面前。
// 常量统一收敛到 PlaceBehaviorConfig。

import type { Behavior, BehaviorContext } from "../../../ai";
import type { AiBehaviorContext } from "../brainEngine";

/** 自动放置行为配置（统一管理） */
export interface PlaceBehaviorConfig {
  /** 放置间隔（引擎周期 = 10 tick） */
  interval: number;
}

/** 默认配置（统一管理；makePlaceBehavior 可传自定义配置覆盖） */
export const DEFAULT_PLACE_CONFIG: PlaceBehaviorConfig = {
  interval: 3,
};

/** 创建自动放置行为（record.workMode === "place" 时由引擎注册） */
export function makePlaceBehavior(config: PlaceBehaviorConfig = DEFAULT_PLACE_CONFIG): Behavior {
  let tick = 0;

  return {
    name: "place",
    priority: 10,
    canActivate: (ctx) => ctx.memory.get<string>("workMode") === "place", // 记忆注入自校验
    reset: () => {
      tick = 0;
    },
    step: (ctx) => {
      if (++tick % config.interval !== 0) return;
      const bot = (ctx as AiBehaviorContext).bot; // 引擎注入实体——零 resolve
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
