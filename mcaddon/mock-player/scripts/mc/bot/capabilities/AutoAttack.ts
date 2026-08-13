// ─── 能力：自动攻击（3tick） ──────────────────────────
// 响应 TAG_AUTO_ATTACK：持续攻击前方（attack 空挥）。

import { TAG_AUTO_ATTACK } from "../../../core/tags/BotTags";
import type { BotCapability, BotContext } from "../../../core/bot/Engine";
import type { MockBot } from "../MockBot";

/** 自动攻击能力工厂（标签状态驱动启停） */
export function autoAttackCapability(bot: MockBot): BotCapability {
  return {
    id: "auto-attack",
    tickInterval: 3,
    enabled: (ctx: BotContext) => ctx.tags.includes(TAG_AUTO_ATTACK.value),
    tick: (): void => {
      const sim = bot.getEntity();
      if (!sim) return;
      try {
        sim.attack();
      } catch (e: any) {
        console.warn(`[MockPlayer] 自动攻击异常 ${bot.name}: ${e?.message ?? e}`);
      }
    },
  };
}
