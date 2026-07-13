// ─── 体态操作（核心层） ────────────────────────────────
// 给假人设置朝向/视线，不依赖上层模块。
// setPose/lookAt 被 spawn/teleport/control/behavior 共用。

import { TeleportOptions, Vector2, Vector3 } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

/**
 * 设置假人朝向（body yaw + head pitch）
 * 不延迟，直接执行
 */
export function setPose(
  bot: SimulatedPlayer,
  rotation: Vector2,
  lookTarget?: Vector3,
): void {
  const opts: TeleportOptions = { rotation };
  if (lookTarget) opts.facingLocation = lookTarget;
  bot.teleport(bot.location, opts);
}

/**
 * 扭头：仅头部转向固定坐标点，身体不动
 */
export function lookAt(
  bot: SimulatedPlayer,
  target: Vector3,
): void {
  bot.lookAtLocation(target, LookDuration.Continuous);
}
