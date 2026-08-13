// ─── 能力：自动放置（5tick） ──────────────────────────
// 响应 TAG_AUTO_PLACE：持续执行放置（startBuild(0) + stopBuild）。
// 停用时清理残留建造（stopBuild）——引擎 enabled 切换调用 onDisabled。

import { TAG_AUTO_PLACE } from "../../../core/tags/BotTags";
import type { BotCapability, BotContext } from "../../../core/bot/Engine";
import type { MockBot } from "../MockBot";

/** 自动放置能力工厂（标签状态驱动启停） */
export function autoPlaceCapability(bot: MockBot): BotCapability {
  return {
    id: "auto-place",
    tickInterval: 5,
    enabled: (ctx: BotContext) => ctx.tags.includes(TAG_AUTO_PLACE.value),
    tick: (): void => {
      const sim = bot.getEntity();
      if (!sim) return;
      try {
        sim.stopBreakingBlock();
        sim.startBuild(0);
        sim.stopBuild();
      } catch (e: any) {
        console.warn(`[MockPlayer] 自动放置异常 ${bot.name}: ${e?.message ?? e}`);
      }
    },
    onDisabled: (): void => {
      const sim = bot.getEntity();
      if (!sim) return;
      try {
        sim.stopBuild();
      } catch {
        /* 实体可能已失效 */
      }
    },
  };
}
