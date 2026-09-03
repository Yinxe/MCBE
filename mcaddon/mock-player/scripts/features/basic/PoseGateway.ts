// ─── 体态操作网关（mc 层） ──────────────────────────────
// 底层体态操作（微动作：system.run 下一 tick 执行，成功 resolve(true)，
// 引擎异常内部消化转 ActionError）、视角目标计算（数学部分在
// core/rules/coords/Direction）、体态持久化。
// ⚠️ 调用方约定：await 感知结果（或 void + .catch 记日志），
//    未接住的拒绝会成为 unhandledrejection。

import { Player } from "@minecraft/server";
import type { Vector2, Vector3 } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import { ActionError } from "../../errors";
import { runActionNextTick } from "../utils";
import type { BotRecord } from "../../rules/Types";
import { rotationToDirection } from "../../rules/coords/Direction";

// ─── 底层体态操作 ──────────────────────────────────────

/**
 * 设置假人朝向（body yaw + head pitch），可选头部看向。
 * 微动作：system.run 推迟到下一 tick 执行（世界状态操作须在 system 上下文）；
 * 成功 resolve(true)，引擎异常内部消化转 ActionError。
 * @param bot 假人实体
 * @param rotation 目标朝向（yaw/pitch）
 * @param lookTarget 可选头部看向点（Continuous 持续看向）
 * @returns 成功 resolve(true)
 * @throws ActionError 引擎传送/转向调用失败（failed，根因在 cause）
 */
export function setPose(
  bot: SimulatedPlayer,
  rotation: Vector2,
  lookTarget?: Vector3,
): Promise<boolean> {
  return runActionNextTick(() => {
    bot.teleport(bot.location, { rotation });
    if (lookTarget) {
      bot.lookAtLocation(lookTarget, LookDuration.Continuous);
    }
  }, "设置假人体态失败");
}

/**
 * 扭头：仅头部转向固定坐标点，身体不动（chunkload 模式不支持）。
 * 微动作：system.run 推迟到下一 tick 执行；成功 resolve(true)，
 * 引擎异常内部消化转 ActionError。
 * @param bot 假人实体
 * @param target 看向点坐标
 * @returns 成功 resolve(true)
 * @throws ActionError 引擎转向调用失败（failed，根因在 cause）
 */
export function lookAt(
  bot: SimulatedPlayer,
  target: Vector3,
): Promise<boolean> {
  return runActionNextTick(() => {
    bot.lookAtLocation(target, LookDuration.Continuous);
  }, "假人转向失败");
}

/**
 * 面向目标点（用户拍板的兴趣点原则：bot 做任何事都应有目标点，**身体朝向
 * 与视线都要看向那个点**——仅 lookAtLocation 转头、身体不面向时引擎的
 * 挖掘/交互判定会落空）。
 * 微动作：system.run 推迟到下一 tick 执行；成功 resolve(true)，
 * 引擎异常内部消化转 ActionError。
 * @param bot 假人实体
 * @param target 兴趣点坐标（身体 yaw 对准其水平方位；头部持续看向该点）
 * @returns 成功 resolve(true)
 * @throws ActionError 引擎转向调用失败（failed，根因在 cause）
 */
export function faceTowards(
  bot: SimulatedPlayer,
  target: Vector3,
): Promise<boolean> {
  return runActionNextTick(() => {
    const dx = target.x - bot.location.x;
    const dz = target.z - bot.location.z;
    // yaw = -atan2(dx, dz) 转度（与 rules FishingRules.computeTargetYaw 同式：
    // 东向 dx>0 → -90；南向 dz>0 → 0）
    bot.setBodyRotation((-Math.atan2(dx, dz) * 180) / Math.PI);
    bot.lookAtLocation(target, LookDuration.Continuous);
  }, "假人面向目标失败");
}

/**
 * 注视实体（引擎持续追踪实体当前位置——跟随等面向动态目标用）。
 * 微动作：system.run 推迟到下一 tick 执行；成功 resolve(true)，
 * 引擎异常内部消化转 ActionError。
 * @param bot 假人实体
 * @param target 看向的实体
 * @returns 成功 resolve(true)
 * @throws ActionError 引擎注视调用失败（failed，根因在 cause）
 */
export function lookAtEntity(
  bot: SimulatedPlayer,
  target: import("@minecraft/server").Entity,
): Promise<boolean> {
  return runActionNextTick(() => {
    bot.lookAtEntity(target, LookDuration.Continuous);
  }, "假人注视目标失败");
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
