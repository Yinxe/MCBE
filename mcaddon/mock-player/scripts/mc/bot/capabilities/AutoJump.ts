// ─── 能力：自动跳跃（3tick） ──────────────────────────
// 响应 TAG_AUTO_JUMP：持续跳跃。

import { TAG_AUTO_JUMP } from "../../../core/tags/BotTags";
import type { BotCapability, BotContext } from "../../../core/bot/Engine";
import type { MockBot } from "../MockBot";

/** 自动跳跃能力工厂（标签状态驱动启停） */
export function autoJumpCapability(bot: MockBot): BotCapability {
  return {
    id: "auto-jump",
    tickInterval: 3,
    enabled: (ctx: BotContext) => ctx.tags.includes(TAG_AUTO_JUMP.value),
    tick: (): void => {
      const sim = bot.getEntity();
      if (!sim) return;
      try {
        sim.jump();
      } catch (e: any) {
        console.warn(`[MockPlayer] 自动跳跃异常 ${bot.name}: ${e?.message ?? e}`);
      }
    },
  };
}
