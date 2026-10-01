// ─── 单拍破坏原语（逐拍决策大脑专用：瞄/挥/停各一次调用，无协程） ───
// 与 Breaker 分工：Breaker 承载协程式连破（挖矿掘进），本件承载"大脑每拍重新裁决"的
// 一次性动作——挥拍按坐标进行不吃视线，aim 仅服务视觉指向（Continuous 保持转头跟踪）。
// 全部静默容错：实体瞬态失效返回 false/no-op，判责在大脑侧（够不着/读不到各自计数）。

import type { Vec3 } from "../domain/Coords";
import { blockCenterIn, botOf, botValid } from "./Atomic";
import { LookDuration } from "@minecraft/server-gametest";

/**
 * 连续注视锚定到目标格（引擎权威块中心——瞄准必须用它）。
 * Instant 约 2s 后引擎自动回正朝向，持续破坏必须 Continuous。
 */
export function aimCell(botId: number, cell: Vec3): void {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return;
  try {
    const center = blockCenterIn(bot.dimension, cell);
    if (center) bot.lookAtLocation(center, LookDuration.Continuous);
  } catch {
    /* 瞄准失败不拦破坏 */
  }
}

/**
 * 对该格挥拍一次（逐格破坏进度独立，格间不需要 stop）。
 * @returns true=本次挥拍被引擎受理
 */
export function swingCell(botId: number, cell: Vec3): boolean {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return false;
  try {
    return bot.breakBlock({ x: cell.x, y: cell.y, z: cell.z });
  } catch {
    return false;
  }
}

/** 停止当前破坏（换格交接/回导航/停机；幂等） */
export function stopSwing(botId: number): void {
  const bot = botOf(botId);
  if (!bot || !botValid(bot)) return;
  try {
    bot.stopBreakingBlock();
  } catch {
    /* 瞬态失效 */
  }
}
