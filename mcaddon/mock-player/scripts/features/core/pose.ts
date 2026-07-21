// ─── 体态操作（核心层） ────────────────────────────────
// 包含底层体态操作、视角计算、数据持久化，无上层业务依赖。
//
// 对于 GameTest 管理的假人（chunkload 模式），lookAtLocation
// 会被 GameTest 每 tick 重置。解决方案：定期重新施加视线方向。

import { Player, Vector2, Vector3, system } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "./types";

// ─── 持续视觉锁定（用于 chunkload 模式） ───────────────
// 实体 ID → { target, intervalId }
const lookIntervals = new Map<string, { target: Vector3; id: number }>();

function startLookRefresh(entityId: string, target: Vector3, bot: SimulatedPlayer): void {
  stopLookRefresh(entityId);
  const id = system.runInterval(() => {
    try {
      if (!(bot as any).isValid) { stopLookRefresh(entityId); return; }
      bot.lookAtLocation(target, LookDuration.Instant);
    } catch { stopLookRefresh(entityId); }
  }, 3);
  lookIntervals.set(entityId, { target, id });
}

function stopLookRefresh(entityId: string): void {
  const existing = lookIntervals.get(entityId);
  if (existing) {
    system.clearRun(existing.id);
    lookIntervals.delete(entityId);
  }
}

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

/** 扭头：仅头部转向固定坐标点，身体不动 */
export function lookAt(
  bot: SimulatedPlayer,
  target: Vector3,
  continuous: boolean = true,
): void {
  // 清理旧 interval（如存在）
  stopLookRefresh((bot as any).id);

  if (continuous) {
    bot.lookAtLocation(target, LookDuration.Continuous);
  } else {
    // 非 Continuous 模式（chunkload）：用 runInterval 定期重施加，
    // 绕开 GameTest 对实体旋转的每 tick 重置
    bot.lookAtLocation(target, LookDuration.Instant);
    startLookRefresh((bot as any).id, target, bot);
  }
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
