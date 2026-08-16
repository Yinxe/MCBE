// ─── 自动挖掘能力（新框架 scripts/ai：Behavior 状态机） ──
// 用户拍板：自动挖掘做成生物 AI 行为（简单能力）。
// 逻辑（对齐旧标签行为）：视线方向距离内 breakBlock；每引擎周期挖一次
// （连续挖掘，无明显停顿）。step 同步短步（无循环无 await）；
// 无目标（视线无方块）→ 下周期重试。常量统一收敛到 MineBehaviorConfig。

import type { Behavior, BehaviorContext } from "../../../ai";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/** 自动挖掘行为配置（统一管理） */
export interface MineBehaviorConfig {
  /** 挖掘距离（格）：视线方向探测范围 */
  distance: number;
  /** 挖掘间隔（引擎周期 = 10 tick）：每周期挖一次 = 连续挖掘 */
  interval: number;
}

/** 默认配置（统一管理；makeMineBehavior 可传自定义配置覆盖） */
export const DEFAULT_MINE_CONFIG: MineBehaviorConfig = {
  distance: 6,
  interval: 1,
};

/** 创建自动挖掘行为（record.aiBehavior === "mine" 时由引擎注册） */
export function makeMineBehavior(config: MineBehaviorConfig = DEFAULT_MINE_CONFIG): Behavior {
  let tick = 0;

  return {
    name: "mine",
    priority: 10,
    canActivate: (ctx) => ctx.memory.get<string>("aiBehavior") === "mine", // 记忆注入自校验
    reset: () => {
      tick = 0;
    },
    step: (ctx) => {
      if (++tick % config.interval !== 0) return;
      const bot = resolveBotPlayer(ctx.botName);
      if (!bot) return;
      try {
        const hit = bot.getBlockFromViewDirection({ maxDistance: config.distance });
        if (hit) bot.breakBlock(hit.block.location, hit.face);
      } catch (e: any) {
        console.warn(`[MockPlayer] 自动挖掘异常 ${ctx.botName}: ${e?.message ?? e}`);
      }
    },
  };
}
