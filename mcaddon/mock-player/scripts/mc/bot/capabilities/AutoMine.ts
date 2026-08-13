// ─── 能力：自动挖掘（1tick） ──────────────────────────
// 响应 TAG_AUTO_MINE：持续挖掘视线前方方块（maxDistance 6）。
// 停用时清理残留挖掘（stopBreakingBlock）——引擎 enabled 切换调用 onDisabled。

import { Player } from "@minecraft/server";

import { TAG_AUTO_MINE } from "../../../core/tags/BotTags";
import type { BotCapability, BotContext } from "../../../core/bot/Engine";
import type { MockBot } from "../MockBot";

/** 自动挖掘能力工厂（标签状态驱动启停） */
export function autoMineCapability(bot: MockBot): BotCapability {
  return {
    id: "auto-mine",
    tickInterval: 1,
    enabled: (ctx: BotContext) => ctx.tags.includes(TAG_AUTO_MINE.value),
    tick: (): void => {
      const sim = bot.getEntity();
      if (!sim) return;
      try {
        const hit = sim.getBlockFromViewDirection({ maxDistance: 6 });
        if (hit) sim.breakBlock(hit.block.location, hit.face);
      } catch (e: any) {
        console.warn(`[MockPlayer] 自动挖掘异常 ${bot.name}: ${e?.message ?? e}`);
      }
    },
    onDisabled: (): void => {
      const sim = bot.getEntity();
      if (!sim) return;
      try {
        sim.stopBreakingBlock();
      } catch {
        /* 实体可能已失效 */
      }
    },
  };
}
