// ─── 自动挖掘能力（新框架 scripts/ai：Behavior 状态机） ──
// 用户拍板：自动挖掘做成生物 AI 行为（简单能力）。
// 逻辑（对齐旧标签行为）：视线方向 6 格内 breakBlock；每 2 个引擎周期
// （20 tick）挖一次——不每 tick 暴力连挖，节奏自然。
// step 同步短步（无循环无 await）；无目标（视线无方块）→ 下周期重试。

import type { Behavior, BehaviorContext } from "../../../ai";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/** 挖掘距离（格） */
const MINE_DISTANCE = 6;
/** 挖掘间隔（引擎周期 = 10 tick：每 2 周期挖一次） */
const MINE_INTERVAL = 2;

/** 创建自动挖掘行为（record.aiBehavior === "mine" 时由引擎注册） */
export function makeMineBehavior(): Behavior {
  let tick = 0;

  return {
    name: "mine",
    priority: 10,
    canActivate: () => true, // 引擎按 aiBehavior 注册/卸载，激活即运行
    reset: () => {
      tick = 0;
    },
    step: (ctx) => {
      if (++tick % MINE_INTERVAL !== 0) return;
      const bot = resolveBotPlayer(ctx.botName);
      if (!bot) return;
      try {
        const hit = bot.getBlockFromViewDirection({ maxDistance: MINE_DISTANCE });
        if (hit) bot.breakBlock(hit.block.location, hit.face);
      } catch (e: any) {
        console.warn(`[MockPlayer] 自动挖掘异常 ${ctx.botName}: ${e?.message ?? e}`);
      }
    },
  };
}
