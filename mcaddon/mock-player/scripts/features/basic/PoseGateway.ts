// ─── 体态操作网关（mc 层） ──────────────────────────────
// 底层体态操作、视角目标计算（数学部分在 core/rules/coords/Direction）、体态持久化。

import { Player } from "@minecraft/server";
import type { Vector2, Vector3 } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord, PositionState } from "../../rules/Types";
import { rotationToDirection } from "../../rules/coords/Direction";

// 自动复活期间，实体的引擎姿态可能在生成后被重置。保护的是记录中的
// 持久姿态，不是通过定时器持续锁定实体。
const protectedPoseRecords = new Set<string>();

/** 标记记录的姿态为受保护状态：普通位置保存不得覆盖已保存的方向。 */
export function protectStoredPose(record: BotRecord): void {
  protectedPoseRecords.add(record.name);
}

/** 玩家明确执行姿态同步前解除保护，允许保存新方向。 */
export function releaseStoredPose(record: BotRecord): void {
  protectedPoseRecords.delete(record.name);
}

/** 当前记录是否处于姿态保护状态。 */
export function isStoredPoseProtected(record: BotRecord): boolean {
  return protectedPoseRecords.has(record.name);
}

/** 复制点位快照，避免复活流程后续修改记录时反向污染快照。 */
export function clonePositionState(state: PositionState): PositionState {
  return {
    location: { ...state.location },
    dimension: state.dimension,
    rotation: { ...state.rotation },
    lookTarget: state.lookTarget ? { ...state.lookTarget } : { x: 0, y: 0, z: 0 },
  };
}

/**
 * 用一份完整点位快照更新 lastPoint。
 * 该入口只负责记录状态，不读取实体当前旋转，供复活流程恢复已保存姿态。
 */
export function restoreStoredPoint(record: BotRecord, state: PositionState): void {
  record.lastPoint = clonePositionState(state);
}

// ─── 底层体态操作 ──────────────────────────────────────

/** 只设置实体身体的俯仰/偏航，不创建持续视角控制。 */
export function setBodyPose(bot: SimulatedPlayer, rotation: Vector2): void {
  bot.teleport(bot.location, { rotation });
}

/**
 * 设置完整的玩家主动姿态：先设置身体方向，再启动持续视角控制。
 * 该入口只给玩家明确同步姿态的路径使用。
 */
export function setPose(
  bot: SimulatedPlayer,
  rotation: Vector2,
  lookTarget?: Vector3,
): void {
  setBodyPose(bot, rotation);
  if (lookTarget) {
    bot.lookAtLocation(lookTarget, LookDuration.Continuous);
  }
}

/** 仅恢复给定持久化点位的身体方向；不能把 lookTarget 再次变成持续控制器。 */
export function restoreStoredBodyPose(bot: SimulatedPlayer, state: PositionState): void {
  setBodyPose(bot, state.rotation);
}

/** 从记录当前 lastPoint 恢复身体方向，供上线后的普通姿态收尾使用。 */
export function restoreCurrentStoredBodyPose(bot: SimulatedPlayer, record: BotRecord): void {
  if (!record.lastPoint) return;
  restoreStoredBodyPose(bot, record.lastPoint);
}

/**
 * 复活/上线后的内部校准：只比较并恢复身体方向，不触碰持续视角。
 * @param activeBehavior 该假人当前是否有主动行为（控制模式/工作模式）：
 *   true 时跳过强制拉回，避免与 AI 转头/控制同步互相覆盖。
 */
export function reconcileStoredPose(bot: SimulatedPlayer, record: BotRecord, activeBehavior = false): void {
  if (!isStoredPoseProtected(record) || !record.lastPoint) return;
  if (activeBehavior) return;
  const expected = record.lastPoint.rotation;
  const actual = bot.getRotation();
  const changed = Math.abs(actual.x - expected.x) > 0.5 || Math.abs(actual.y - expected.y) > 0.5;
  if (changed) setBodyPose(bot, expected);
}

/** 扭头：仅头部转向固定坐标点（chunkload 模式不支持）。 */
export function lookAt(
  bot: SimulatedPlayer,
  target: Vector3,
): void {
  bot.lookAtLocation(target, LookDuration.Continuous);
}

// ─── 视角计算 ──────────────────────────────────────────

/** 计算玩家当前看向的目标点（小数精度，不再取整到方块中心）。 */
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

/** 统一入口：将体态数据持久化到 BotRecord.lastPoint。 */
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
  if (rotation && !isStoredPoseProtected(record)) record.lastPoint.rotation = rotation;
  if (lookTarget !== undefined && !isStoredPoseProtected(record)) record.lastPoint.lookTarget = lookTarget;
}
