// ─── 放置方块原子能力（basic：手持物品动作） ────────────
// 一次"放置主手方块到面前"的微动作（system.run 下一 tick 执行）：
//   bot.stopBreakingBlock()  // 中断进行中的挖掘（防放置/挖掘冲突）
//   bot.startBuild(0)        // 进入放置模式（放面前方块）
//   bot.stopBuild()          // 结束放置动作
//
// ⚠️ 语义：放置**面前**方块（由假人视角决定），非指定坐标；主手须是可放置
//    方块，否则引擎静默无效果。引擎异常内部消化转 ActionError。

import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { runActionNextTick } from "../../utils";

/**
 * 原子放置一个方块到假人面前（主手物品）。
 * 微动作：system.run 推迟到下一 tick 执行（世界状态操作须在 system 上下文）；
 * 成功 resolve(true)，引擎异常内部消化转 ActionError——调用方可 await 感知
 * 结果，或 fire-and-forget（需 .catch 记日志，无未处理拒绝）。
 * 不可取消——startBuild/stopBuild 是同步瞬时调用，无需异步等待/取消。
 *
 * @param bot 假人实体（SimulatedPlayer——startBuild/stopBuild 特有方法）
 * @returns 成功 resolve(true)
 * @throws ActionError 实体状态异常/受限模式等引擎失败（failed，根因在 cause）
 */
export function placeBlockOnce(bot: SimulatedPlayer): Promise<boolean> {
  return runActionNextTick(() => {
    // ⚠️ 先中断进行中的挖掘（正挖方块时 startBuild 会冲突）
    bot.stopBreakingBlock();
    bot.startBuild(0);
    bot.stopBuild();
  }, "放置主手方块失败");
}
