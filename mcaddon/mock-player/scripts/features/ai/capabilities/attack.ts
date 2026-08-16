// ─── 自动攻击能力（新框架 scripts/ai：Behavior 状态机） ──
// 用户拍板：自动攻击做成生物 AI 行为（简单能力）。
// 逻辑（对齐旧标签行为）：对视线/面前目标 attack()；每引擎周期攻击一次
// （连续攻击，无明显停顿）。常量统一收敛到 AttackBehaviorConfig。

import type { Behavior, BehaviorContext } from "../../../ai";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/** 自动攻击行为配置（统一管理） */
export interface AttackBehaviorConfig {
  /** 攻击间隔（引擎周期 = 10 tick）：每周期攻击一次 = 连续攻击 */
  interval: number;
}

/** 默认配置（统一管理；makeAttackBehavior 可传自定义配置覆盖） */
export const DEFAULT_ATTACK_CONFIG: AttackBehaviorConfig = {
  interval: 1,
};

/** 创建自动攻击行为（record.aiBehavior === "attack" 时由引擎注册） */
export function makeAttackBehavior(config: AttackBehaviorConfig = DEFAULT_ATTACK_CONFIG): Behavior {
  let tick = 0;

  return {
    name: "attack",
    priority: 10,
    canActivate: (ctx) => ctx.memory.get<string>("aiBehavior") === "attack", // 记忆注入自校验
    reset: () => {
      tick = 0;
    },
    step: (ctx) => {
      if (++tick % config.interval !== 0) return;
      const bot = resolveBotPlayer(ctx.botName);
      if (!bot) return;
      try {
        bot.attack();
      } catch (e: any) {
        console.warn(`[MockPlayer] 自动攻击异常 ${ctx.botName}: ${e?.message ?? e}`);
      }
    },
  };
}
