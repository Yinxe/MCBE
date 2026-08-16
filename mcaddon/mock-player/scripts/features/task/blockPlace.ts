// ─── 放置单个方块原子能力（mc 层，与 blockBreak 对称） ──
// 一次"放置主手方块到面前"的原子动作：
//   bot.stopBreakingBlock()  // 中断进行中的挖掘（防放置/挖掘动作冲突）
//   bot.startBuild(0)        // 进入放置模式（放置面前方块）
//   bot.stopBuild()          // 结束放置动作
// 封装为可复用原子函数——供自动放置能力 / 流程脚本调用。
//
// ⚠️ 语义：放置**面前**方块（由假人当前视角决定），非指定坐标；
//    主手必须是可放置方块，否则该动作无效果（引擎静默）。
//    失败时 try-catch 容错（不影响调用方流程）。

import type { SimulatedPlayer } from "@minecraft/server-gametest";
import type { CancelToken } from "../../rules/utils/CancelToken";

// ─── 选项 ──────────────────────────────────────────────

/** 放置动作选项 */
export interface PlaceOnceOptions {
  /**
   * 取消令牌：配套长协程（自动放置循环）——放置前若已取消则跳过。
   * 放置本身是瞬时同步动作（非等待），token 用于"进入放置前是否仍应放置"。
   */
  token?: CancelToken;
}

// ─── 原子放置单个方块 ──────────────────────────────────

/**
 * 原子放置一个方块到假人面前（主手物品）。
 * 等价旧行为 startBuild/stopBuild 序列，封装为单一返回值原子能力。
 *
 * @param bot    假人实体（SimulatedPlayer——startBuild/stopBuild 特有）
 * @param options 选项（取消令牌）
 * @returns true=已发起放置动作；false=未放置（已取消/实体无效）
 */
export function placeBlockOnce(bot: SimulatedPlayer, options: PlaceOnceOptions = {}): boolean {
  // 放置前取消检查（长协程场景：token 已取消 → 跳过本次放置）
  if (options.token?.cancelled) return false;
  try {
    // ⚠️ 中断进行中的挖掘（正挖方块时 startBuild 会冲突——先 stopBreaking）
    bot.stopBreakingBlock();
    bot.startBuild(0); // 放置模式（放主手方块到面前）
    bot.stopBuild();
    return true;
  } catch {
    // 放置失败容错（实体状态异常/受限模式）：不影响调用方流程
    return false;
  }
}
