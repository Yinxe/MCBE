// ─── 体态操作网关（mc 层） ──────────────────────────────
// 底层体态操作、视角目标计算（数学部分在 core/coords/Direction）、体态持久化。

import { Player } from "@minecraft/server";
import type { Vector2, Vector3 } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "../../model/Types";
import { rotationToDirection } from "../../coords/Direction";

// ─── 底层体态操作 ──────────────────────────────────────

/** 设置假人朝向（body yaw + head pitch），可选头部转向 */
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

/** 扭头：仅头部转向固定坐标点，身体不动（chunkload 模式不支持） */
export function lookAt(
  bot: SimulatedPlayer,
  target: Vector3,
): void {
  bot.lookAtLocation(target, LookDuration.Continuous);
}

// ─── 视角计算 ──────────────────────────────────────────

/** 计算玩家当前看向的目标点（小数精度，不再取整到方块中心） */
export function getPlayerLookTarget(player: Player, maxDistance: number = 64): Vector3 {
  const head = player.getHeadLocation();
  const dir = rotationToDirection(player.getRotation());
  return {
    x: head.x + dir.x * maxDistance,
    y: head.y + dir.y * maxDistance,
    z: head.z + dir.z * maxDistance,
  };
}

// ─── 持久化 ────────────────────────────────────────────

/** 统一入口：将体态数据持久化到 BotRecord.lastPoint */
export function savePoseToRecord(
  record: BotRecord,
  location?: Vector3,
  dimension?: string,
  rotation?: Vector2,
  lookTarget?: Vector3,
): void {
  if (!record.lastPoint) return;
  if (location) record.lastPoint.location = location;
  if (dimension) record.lastPoint.dimension = dimension;
  if (rotation) record.lastPoint.rotation = rotation;
  if (lookTarget !== undefined) record.lastPoint.lookTarget = lookTarget;
}