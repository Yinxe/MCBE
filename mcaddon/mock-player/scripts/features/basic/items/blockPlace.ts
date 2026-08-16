// ─── 放置方块原子能力（basic：手持物品动作） ────────────
// 一次"放置主手方块到面前"的同步原子动作（简单快，不可取消）：
//   bot.stopBreakingBlock()  // 中断进行中的挖掘（防放置/挖掘冲突）
//   bot.startBuild(0)        // 进入放置模式（放面前方块）
//   bot.stopBuild()          // 结束放置动作
//
// ⚠️ 语义：放置**面前**方块（由假人视角决定），非指定坐标；主手须是可放置
//    方块，否则引擎静默无效果。内部容错返回 boolean，不影响调用方流程。

import type { SimulatedPlayer } from "@minecraft/server-gametest";

/**
 * 原子放置一个方块到假人面前（主手物品）。
 * 同步、瞬时、不可取消——startBuild/stopBuild 是同步调用，无需异步/等待。
 *
 * @param bot 假人实体（SimulatedPlayer——startBuild/stopBuild 特有方法）
 * @returns true=已发起放置动作；false=放置失败（实体状态异常/受限模式）
 */
export function placeBlockOnce(bot: SimulatedPlayer): boolean {
  try {
    // ⚠️ 先中断进行中的挖掘（正挖方块时 startBuild 会冲突）
    bot.stopBreakingBlock();
    bot.startBuild(0);
    bot.stopBuild();
    return true;
  } catch {
    // 放置失败容错（不影响调用方流程）
    return false;
  }
}
