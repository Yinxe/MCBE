// ─── 体态操作（核心层） ────────────────────────────────
// 包含底层体态操作、视角计算、数据持久化，无上层业务依赖。

import { Player, Vector2, Vector3 } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "./types";

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

function rotationToDirection(rotation: Vector2): Vector3 {
  const pitchRad = (rotation.x * Math.PI) / 180;
  const yawRad = (rotation.y * Math.PI) / 180;
  return {
    x: -Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad),
  };
}

/** 计算玩家当前看向的目标点 */
export function getPlayerLookTarget(player: Player, maxDistance: number = 64): Vector3 {
  const hit = player.getBlockFromViewDirection({ maxDistance });
  if (hit) {
    const b = hit.block;
    return { x: b.location.x + 0.5, y: b.location.y + 0.5, z: b.location.z + 0.5 };
  }
  // 无命中时取 10 格外的稳定点（作为假人视线方向参考，太远头几乎不动）
  const head = player.getHeadLocation();
  const dir = rotationToDirection(player.getRotation());
  const FALLBACK_DISTANCE = 10;
  return {
    x: head.x + dir.x * FALLBACK_DISTANCE,
    y: head.y + dir.y * FALLBACK_DISTANCE,
    z: head.z + dir.z * FALLBACK_DISTANCE,
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
