// ─── 体态管理（业务层） ──────────────────────────────
//
// 高层体态功能：视角计算 + 持久化。
// 底层体态操作（setPose/lookAt）在 core/pose.ts 中。
//
// 依赖：core/pose（setPose）、core/types（BotRecord）

import { Player, Vector2, Vector3 } from "@minecraft/server";

import type { BotRecord } from "./core/types";
import { setPose } from "./core/pose";

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

// ─── 持久化 ────────────────────────────────────────────

/**
 * 统一入口：将体态数据持久化到 BotRecord.lastPoint
 */
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
