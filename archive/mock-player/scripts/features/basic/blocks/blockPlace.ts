// ─── 放置方块原子能力（basic：手持物品动作） ────────────
// 一次"放置主手方块到面前"的异步原子动作（简单快，不可取消）：
//   system.run(() => {
//     bot.stopBreakingBlock()  // 中断进行中的挖掘（防放置/挖掘冲突）
//     bot.startBuild(0)        // 进入放置模式（放面前方块）
//     bot.stopBuild()          // 结束放置动作
//   })
//
// ⚠️ 异步原因：startBuild/stopBuild 是世界状态操作，须在 system.run() 回调
//    内执行（对齐仓库约定）；函数返回 Promise，调用方等待结果或 fire-and-forget。
// ⚠️ 语义：放置**面前**方块（由假人视角决定），非指定坐标；主手须是可放置
//    方块，否则引擎静默无效果。内部容错 resolve(false)，不影响调用方流程。

import { system } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

/**
 * 原子放置一个方块到假人面前（主手物品）。
 * 异步：放置动作在 system.run() 回调内执行（世界状态操作须在 system 上下文），
 * 返回 Promise<boolean>——调用方可 await 取结果，或直接 fire-and-forget
 * （动作已入队，无未处理拒绝：所有路径均 resolve）。
 * 不可取消——startBuild/stopBuild 是同步瞬时调用，无需异步等待/取消。
 *
 * @param bot 假人实体（SimulatedPlayer——startBuild/stopBuild 特有方法）
 * @returns Promise<true=已发起放置动作；false=放置失败（实体状态异常/受限模式）>
 */
export async function placeBlockOnce(bot: SimulatedPlayer): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    system.run(() => {
      try {
        // ⚠️ 先中断进行中的挖掘（正挖方块时 startBuild 会冲突）
        bot.stopBreakingBlock();
        bot.startBuild(0);
        bot.stopBuild();
        resolve(true);
      } catch {
        // 放置失败容错（不影响调用方流程）
        resolve(false);
      }
    });
  });
}
