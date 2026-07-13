// ─── 体态修正 ──────────────────────────────────────────
//
// 统一管理假人的身位旋转和视线方向。
// setPose: 设置 body rotation + head look direction（完整姿态）
// lookAt:  仅头部转向目标，身体不动（扭头功能）
// getPlayerLookTarget: 计算玩家视角指向的目标点

import { Player, Vector2, Vector3 } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

// ─── 视角计算 ──────────────────────────────────────────

function rotationToDirection(rotation: Vector2): Vector3 {
  const pitchRad = (rotation.x * Math.PI) / 180;
  const yawRad = (rotation.y * Math.PI) / 180;
  return {
    x: -Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad),
  };
}

/**
 * 计算玩家当前看向的目标点
 * 优先取视线撞到的方块，否则取 64 格外的点
 */
export function getPlayerLookTarget(player: Player, maxDistance: number = 64): Vector3 {
  const hit = player.getBlockFromViewDirection({ maxDistance });
  if (hit) {
    const b = hit.block;
    return { x: b.location.x + 0.5, y: b.location.y + 0.5, z: b.location.z + 0.5 };
  }
  const head = player.getHeadLocation();
  const dir = rotationToDirection(player.getRotation());
  return {
    x: head.x + dir.x * maxDistance,
    y: head.y + dir.y * maxDistance,
    z: head.z + dir.z * maxDistance,
  };
}

// ─── 体态设置 ──────────────────────────────────────────

/**
 * 设置假人完整体态（朝向 + 视线）
 * 用于出生/复活/传送/控制模式等场景
 * 直接执行不延迟（调用方如有需要自行 system.run）
 *
 * @param bot       假人实体
 * @param rotation  体态朝向 (x=俯仰, y=偏航)
 * @param lookTarget 视线目标点（可选，传入后同时设头部转向）
 */
export function setPose(
  bot: SimulatedPlayer,
  rotation: Vector2,
  lookTarget?: Vector3,
): void {
  bot.teleport(bot.location, { rotation });
  if (lookTarget) {
    bot.lookAtLocation(lookTarget, LookDuration.Continuous);
  }
}

/**
 * 扭头：假人持续看向一个固定坐标点
 * 玩家离开后仍看向原位置，不偏航
 *
 * @param bot    假人实体
 * @param target 固定目标坐标（如 player.location）
 */
export function lookAt(
  bot: SimulatedPlayer,
  target: Vector3,
): void {
  bot.lookAtLocation(target, LookDuration.Continuous);
}
