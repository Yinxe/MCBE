// ─── 体态操作网关（mc 层） ──────────────────────────────
// 底层体态操作、视角目标计算（数学部分在 core/rules/coords/Direction）、体态持久化。

import { Player, system } from "@minecraft/server";
import type { Vector2, Vector3 } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord, PositionState } from "../../rules/Types";
import { TAG_CONTROL } from "../../rules/tags/BotTags";
import { rotationToDirection } from "../../rules/coords/Direction";

// 自动复活期间，实体的引擎姿态可能在生成后被重置。保护的是记录中的
// 持久姿态，不是通过定时器持续锁定实体。
const protectedPoseRecords = new Set<string>();

// 保存视线校正任务（模块级运行态：key=假人名）——复活/上线/创建后的有界校正。
interface ViewSettleJob {
  /** 下次重发朝向的 tick */
  nextTick: number;
  /** 截止 tick（超时放弃，防无限重发） */
  expireTick: number;
  /** 是否已发起过持续注视（保证收尾后朝向仍被注视保持） */
  issued: boolean;
}
const viewSettles = new Map<string, ViewSettleJob>();

/** 标记记录的姿态为受保护状态：普通位置保存不得覆盖已保存的方向。 */
export function protectStoredPose(record: BotRecord): void {
  protectedPoseRecords.add(record.name);
}

/** 玩家明确执行姿态同步前解除保护，允许保存新方向；同时终止进行中的视线校准。 */
export function releaseStoredPose(record: BotRecord): void {
  protectedPoseRecords.delete(record.name);
  viewSettles.delete(record.name);
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
 * 设置完整的玩家主动姿态：先设置身体方向，再“持续注视”目标点（Continuous）。
 * ⚠️ 不可改为 Instant：引擎的一次性 look（Instant）约 2 秒后会“回正”失去朝向，
 * 维持朝向必须用持续注视。控制模式每 2 tick 重发本调用属于主动同步；
 * 复活/上线/新同步等生命周期节点会重发替换旧注视，避免残留在旧目标上。
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

// ─── 保存视线保持（复活/上线/创建后的有界校正） ────────
// 复活/上线后实体姿态可能被引擎重置、或一次性设置约 2 秒后“回正”失去朝向。
// 这里在恢复后立即发起“持续注视保存目标”（Continuous + 身体朝向），并在有限
// 窗口内校验头部真正对准（±12°），未对准则重发；对准即收尾，注视保留以保持朝向。
// 旧方案用常驻 reconcile 每 tick 强拉，会与击退/AI/控制互抢（表现为
// “被打一下视角突然回正”）；现只在生成类节点做一次性、有界校正，不做常驻拉回。

/** 校准重发间隔（tick） */
const VIEW_SETTLE_INTERVAL = 4;
/** 校准总时长上限（tick，10 秒）——防极端情况无限重发 */
const VIEW_SETTLE_TIMEOUT = 200;
/** 头部对准容差（度） */
const VIEW_SETTLE_TOLERANCE_DEG = 12;
/** lookTarget 缺失（旧记录 0 占位）时，由保存朝向推导远处目标点的距离（格） */
const VIEW_SETTLE_FALLBACK_DISTANCE = 64;

/** 从 from 指向 target 的朝向角（x=俯仰，y=偏航，单位度；与 rotationToDirection 互逆）。 */
function rotationToward(from: Vector3, target: Vector3): Vector2 {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dz = target.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return { x: 0, y: 0 };
  return {
    x: (Math.asin(-dy / len) * 180) / Math.PI,
    y: (Math.atan2(-dx, dz) * 180) / Math.PI,
  };
}

/** 角度差（度，取最短弧）。 */
function angleDiffDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.abs(d);
}

/** 记录中保存的视线目标坐标；lookTarget 缺失（旧记录为 0 占位）时由保存朝向推导。 */
function resolveSettleTarget(bot: SimulatedPlayer, record: BotRecord): Vector3 | undefined {
  const state = record.lastPoint ?? record.respawnPoint;
  if (!state) return undefined;
  const lt = state.lookTarget;
  if (lt && (lt.x !== 0 || lt.y !== 0 || lt.z !== 0)) return { ...lt };
  // 兜底：由保存朝向推一个远处目标点（与 rotationToDirection 互逆）
  try {
    const dir = rotationToDirection(state.rotation);
    const head = bot.getHeadLocation();
    return {
      x: head.x + dir.x * VIEW_SETTLE_FALLBACK_DISTANCE,
      y: head.y + dir.y * VIEW_SETTLE_FALLBACK_DISTANCE,
      z: head.z + dir.z * VIEW_SETTLE_FALLBACK_DISTANCE,
    };
  } catch { return undefined; }
}

/** 头部是否已真实对准目标坐标（±容差；读取失败按未对准）。 */
function isHeadFacing(bot: SimulatedPlayer, target: Vector3): boolean {
  try {
    const want = rotationToward(bot.getHeadLocation(), target);
    const actual = bot.headRotation;
    return (
      angleDiffDeg(actual.x, want.x) <= VIEW_SETTLE_TOLERANCE_DEG &&
      angleDiffDeg(actual.y, want.y) <= VIEW_SETTLE_TOLERANCE_DEG
    );
  } catch { return false; }
}

/** 身体偏航 + 持续注视一起面向目标（重发一次；注视保留到下次替换）。 */
function faceTargetNow(bot: SimulatedPlayer, target: Vector3): void {
  const want = rotationToward(bot.getHeadLocation(), target);
  try { bot.setBodyRotation(want.y); } catch {}
  try { bot.lookAtLocation(target, LookDuration.Continuous); } catch {}
}

/** 开始保存视线校正（复活/上线/创建后调用；重复调用重置窗口）。 */
export function startViewSettle(record: BotRecord): void {
  const now = system.currentTick;
  viewSettles.set(record.name, { nextTick: now, expireTick: now + VIEW_SETTLE_TIMEOUT, issued: false });
}

/**
 * 校正驱动（由行为主循环每 tick 调用；仅在存在校正任务时执行）：
 * 至少发起一次持续注视；头部对准（±12°）即收尾（注视保留以保持朝向）；
 * 超时放弃；玩家接管（控制模式）/死亡离线 → 终止，避免互抢方向。
 */
export function tickViewSettle(bot: SimulatedPlayer, record: BotRecord): void {
  const job = viewSettles.get(record.name);
  if (!job) return;
  if (record.death || !record.online) { viewSettles.delete(record.name); return; }
  // 玩家接管（控制模式）后校正立即终止——控制同步会自己发起持续注视
  if (bot.hasTag(TAG_CONTROL.value)) { viewSettles.delete(record.name); return; }
  const target = resolveSettleTarget(bot, record);
  if (!target) { viewSettles.delete(record.name); return; }
  const now = system.currentTick;
  if (now < job.nextTick) return;
  if (job.issued && isHeadFacing(bot, target)) {
    // 已对准：持续注视已生效，收尾（不做任何回拉；朝向由注视保持）
    viewSettles.delete(record.name);
    console.info(`[MockPlayer] 视线校准完成 ${record.name}`);
    return;
  }
  if (now >= job.expireTick) {
    viewSettles.delete(record.name);
    console.warn(`[MockPlayer] 视线校准超时放弃 ${record.name}`);
    return;
  }
  faceTargetNow(bot, target);
  job.issued = true;
  job.nextTick = now + VIEW_SETTLE_INTERVAL;
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
