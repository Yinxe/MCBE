// ─── 传送转场:时序、缓动与相机位姿(纯逻辑)─────────────────────
//
// 移植自 Java 版 Fabric 模组 GrandTeleport 26.1.2 的
// `TeleportTransitionController.java` 与 `GtaLikeTeleportConfig.java`。
// 移植的是**数值行为**(阶段顺序、tick 数、高度、缓动曲线、抖动波形),
// 客户端渲染侧的 LocalPlayer / CameraType / hideGui 等没有对应能力,不移植。
//
// 单位统一为 tick(20 tick = 1 秒),与上游一致,便于逐帧对齐。
// 本文件不 import 任何脚本 API 模块,可被 node --test 直接覆盖。

import {
  DEFAULT_CONFIG,
  TRANSITION_STYLES,
  type Position,
  type TransitionStyle,
  type TransitionZoomHeights,
} from "./types";

// 重新导出,便于适配层只从本模块 import 转场相关类型
export type { TransitionZoomHeights };

// ─── 常量:阶段时长(tick)──────────────────────────────────────

/** 相机出体时长。 */
export const EXIT_BODY_TICKS = 12;
/** 相机入体时长。 */
export const ENTER_BODY_TICKS = 12;
/** 出体后、拉远前的悬停时长;入体前也有一段等长的悬停。 */
export const BODY_HOLD_TICKS = 10;
/** 拉远结束到横越开始、横越结束到推近开始的等待时长。 */
export const PRE_TRAVEL_WAIT_TICKS = 10;
export const PRE_PUSH_WAIT_TICKS = 10;
/** 跨维度时用更长的等待代替横越。 */
export const CROSS_DIMENSION_WAIT_TICKS = 20;

// ─── 常量:三段变焦 ──────────────────────────────────────────────

/** 三段变焦的默认时长(tick),拉远与推近相同。 */
export const STAGE_TICKS: TransitionZoomHeights = [13, 13, 13];
/** 三段变焦的默认高度(格)。 */
export const STAGE_HEIGHTS: TransitionZoomHeights = [20, 40, 60];
/** 每段结束时额外滑出的高度(格)。 */
export const STAGE_GLIDE_HEIGHT = 0.5;
/** 段间滑出时长(tick)。 */
export const STAGE_GLIDE_TICKS = 13;

// ─── 常量:出体相机 ──────────────────────────────────────────────

/** 出体后相机离脚的高度(格)。 */
export const BODY_CAMERA_HEIGHT = 6.0;
/** 悬停期间再滑出多少格。 */
export const BODY_GLIDE_HEIGHT = 0.5;
/** 悬停滑出时长(tick)。 */
export const BODY_GLIDE_TICKS = 10;

/** 玩家眼睛相对脚部的高度(格)。脚本 API 不暴露眼睛坐标,按此常量推算。 */
export const EYE_HEIGHT = 1.6;

// ─── 常量:横越 ──────────────────────────────────────────────────

/** 横越时长夹取范围(tick)。 */
export const MIN_TRAVEL_TICKS = 20;
export const MAX_TRAVEL_TICKS = 60;
/** 距离未知时的横越时长。 */
export const DEFAULT_TRAVEL_TICKS = 40;
/** 横越速度:每 tick 30 格。 */
export const TRAVEL_BLOCKS_PER_TICK = 30;
/** 横越两端缓动的半段长度(tick)。 */
export const TRAVEL_EASE_EDGE_TICKS = MIN_TRAVEL_TICKS / 2;

// ─── 常量:视角 ──────────────────────────────────────────────────

/** 俯仰角:变焦与横越全程固定 90° 正俯视。 */
export const TOP_DOWN_PITCH = 90;
/** 俯仰抖动的单侧振幅(度)。 */
export const SHAKE_PITCH_AMPLITUDE = 1.05;
/** 偏航抖动的双向振幅(度)。 */
export const SHAKE_YAW_AMPLITUDE = 0.15;

// ─── 基础工具 ────────────────────────────────────────────────────

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** 把角度规整到 (-180, 180]。 */
export function wrapDegrees(value: number): number {
  let wrapped = value % 360;
  if (wrapped > 180) wrapped -= 360;
  if (wrapped <= -180) wrapped += 360;
  return wrapped;
}

/** 角度插值,走最短路径。 */
export function lerpDegrees(
  from: number,
  to: number,
  progress: number,
): number {
  return from + wrapDegrees(to - from) * clamp(progress, 0, 1);
}

/** 数值线性插值。 */
export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * clamp(progress, 0, 1);
}

/** 三维线性插值。 */
export function lerpPosition(
  from: Position,
  to: Position,
  progress: number,
): Position {
  const x = clamp(progress, 0, 1);
  return {
    x: from.x + (to.x - from.x) * x,
    y: from.y + (to.y - from.y) * x,
    z: from.z + (to.z - from.z) * x,
  };
}

/** 平滑阶梯:3x² − 2x³。 */
export function smoothStep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 缓出三次方。 */
export function easeOutCubic(progress: number): number {
  const x = clamp(progress, 0, 1);
  const inverse = 1 - x;
  return 1 - inverse * inverse * inverse;
}

/** 出体/入体时视角转向的进度(比位置快 1.5 倍)。 */
export function bodyLookProgress(progress: number): number {
  return easeOutCubic(clamp(progress * 1.5, 0, 1));
}

// ─── 变焦段缓动 ──────────────────────────────────────────────────

/**
 * 上游 `hermiteEaseOutFromLinear`:先匀速、后减速到 1。
 *
 * @param decelStart 开始减速的进度点
 * @param linearSpeed 匀速段的速度倍率
 */
export function hermiteEaseOutFromLinear(
  value: number,
  decelStart: number,
  linearSpeed: number,
): number {
  const x = clamp(value, 0, 1);
  if (x <= decelStart) return x * linearSpeed;

  const t = (x - decelStart) / (1 - decelStart);
  const t2 = t * t;
  const t3 = t2 * t;
  const y0 = decelStart * linearSpeed;
  const m0 = linearSpeed * (1 - decelStart);
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  return clamp(h00 * y0 + h10 * m0 + h01, 0, 1);
}

/** 段内滑出进度(前两段用)。 */
export function stageGlideProgress(progress: number): number {
  return hermiteEaseOutFromLinear(progress, 0.64, 1.08);
}

/** 末段滑出进度(减速更早、更缓)。 */
export function finalGlideProgress(progress: number): number {
  return hermiteEaseOutFromLinear(progress, 0.36, 1.0);
}

/** `stageGlideProgress` 的别名,按任务书命名。 */
export const linearThenEaseOut = stageGlideProgress;

/** `finalGlideProgress` 的别名,按任务书命名。 */
export const longEaseOut = finalGlideProgress;

// ─── 相机抖动 ────────────────────────────────────────────────────

/** 抖动只作用于角度,因此单独返回,不与位置耦合。 */
export interface ShakenRotation {
  yaw: number;
  pitch: number;
}

/**
 * 变焦段与横越段的相机微抖。
 *
 * 两组正弦叠加:竖直方向是单侧收缩(−1 偏移后取半),所以只会
 * 让相机更俯视、不会朝天;水平方向是双向摆动。这是「电影感」
 * 的重要来源。
 */
export function applyZoomShake(
  frameTick: number,
  yaw: number,
  pitch: number,
  envelope = 1,
): ShakenRotation {
  const verticalWave =
    Math.sin(frameTick * 0.105) * 0.74 +
    Math.sin(frameTick * 0.052 + 1.6) * 0.26;
  const horizontalWave =
    Math.sin(frameTick * 0.105 + 2.1) * 0.78 +
    Math.sin(frameTick * 0.15 + 0.35) * 0.22;

  const easedEnvelope = clamp(envelope, 0, 1);
  const pitchShake =
    (clamp(verticalWave, -1, 1) - 1) *
    0.5 *
    SHAKE_PITCH_AMPLITUDE *
    easedEnvelope;
  const yawShake = horizontalWave * SHAKE_YAW_AMPLITUDE * easedEnvelope;

  return {
    yaw: yaw + yawShake,
    pitch: clamp(pitch + pitchShake, -90, 90),
  };
}

// ─── 横越 ────────────────────────────────────────────────────────

/** 按水平距离算横越时长:每 tick 30 格,夹在 20–60 tick。 */
export function travelTicksForDistance(from: Position, to: Position): number {
  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;
  const horizontal = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
  return clamp(
    Math.ceil(horizontal / TRAVEL_BLOCKS_PER_TICK),
    MIN_TRAVEL_TICKS,
    MAX_TRAVEL_TICKS,
  );
}

/** 对 smoothstep 做积分,用于横越的加速段。 */
function integratedSmoothStep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * x - 0.5 * x * x * x * x;
}

/** 加速段的补函数,用于横越的减速段。 */
function integratedSmoothStepDown(value: number): number {
  const x = clamp(value, 0, 1);
  return x - integratedSmoothStep(x);
}

/**
 * 横越进度:两端平滑起停、中间匀速。
 *
 * 用积分后的 smoothstep 拼出「加速 → 匀速 → 减速」,
 * 两端各占 `TRAVEL_EASE_EDGE_TICKS` 个 tick。
 */
export function travelEaseProgress(
  progress: number,
  totalTicks: number,
): number {
  const total = Math.max(1, totalTicks);
  const edge = Math.min(TRAVEL_EASE_EDGE_TICKS, total * 0.5);
  const elapsed = clamp(progress, 0, 1) * total;
  const weightedTotal = Math.max(1, total - edge);

  if (elapsed < edge) {
    return (edge * integratedSmoothStep(elapsed / edge)) / weightedTotal;
  }

  const steadyEnd = total - edge;
  if (elapsed <= steadyEnd) {
    return (edge * 0.5 + elapsed - edge) / weightedTotal;
  }

  const decelElapsed = elapsed - steadyEnd;
  const beforeDecel = edge * 0.5 + Math.max(0, total - edge * 2);
  return (
    (beforeDecel + edge * integratedSmoothStepDown(decelElapsed / edge)) /
    weightedTotal
  );
}

// ─── 时间轴 ──────────────────────────────────────────────────────

/** 运镜时间轴。全部字段都是相对运镜起点的 tick 偏移。 */
export interface TransitionTimeline {
  exitStart: number;
  exitEnd: number;
  bodyHoldStart: number;
  bodyHoldEnd: number;
  pullStart: number;
  pullStageTicks: TransitionZoomHeights;
  pullEnd: number;
  preTravelWait: number;
  travelStart: number;
  travelEnd: number;
  /** 实际横越时长;跨维度时为 0 */
  travelTicks: number;
  prePushWait: number;
  pushStart: number;
  pushStageTicks: TransitionZoomHeights;
  pushEnd: number;
  enterHoldStart: number;
  enterHoldEnd: number;
  enterStart: number;
  enterEnd: number;
  totalTicks: number;
}

/** 构造时间轴所需参数。 */
export interface TimelineOptions {
  /** 跨维度时为真:跳过横越,两端改用更长的等待 */
  crossDimension: boolean;
  /** 横越时长,通常来自 `travelTicksForDistance()` */
  distanceTicks?: number;
  /** 三段变焦时长,默认 `STAGE_TICKS` */
  stageTicks?: TransitionZoomHeights;
}

function sumStages(stageTicks: TransitionZoomHeights): number {
  return (stageTicks[0] ?? 0) + (stageTicks[1] ?? 0) + (stageTicks[2] ?? 0);
}

/**
 * 构造完整时间轴。
 *
 * 阶段顺序(与上游一致):
 * 出体 → 悬停 → 拉远三段 → 等待 → 横越 → 等待 → 推近三段 → 悬停 → 入体
 */
export function computeTransitionLayout(
  options: TimelineOptions,
): TransitionTimeline {
  const stageTicks: TransitionZoomHeights = options.stageTicks
    ? [...options.stageTicks]
    : [...STAGE_TICKS];
  const stageTotal = sumStages(stageTicks);

  const exitStart = 0;
  const exitEnd = exitStart + EXIT_BODY_TICKS;

  const bodyHoldStart = exitEnd;
  const bodyHoldEnd = bodyHoldStart + BODY_HOLD_TICKS;

  const pullStart = bodyHoldEnd;
  const pullEnd = pullStart + stageTotal;

  const preTravelWait = options.crossDimension
    ? CROSS_DIMENSION_WAIT_TICKS
    : PRE_TRAVEL_WAIT_TICKS;
  const travelStart = pullEnd + preTravelWait;
  const travelTicks = options.crossDimension
    ? 0
    : Math.max(
        MIN_TRAVEL_TICKS,
        Math.min(
          MAX_TRAVEL_TICKS,
          Math.floor(options.distanceTicks ?? DEFAULT_TRAVEL_TICKS),
        ),
      );
  const travelEnd = travelStart + travelTicks;

  const prePushWait = options.crossDimension
    ? CROSS_DIMENSION_WAIT_TICKS
    : PRE_PUSH_WAIT_TICKS;
  const pushStart = travelEnd + prePushWait;
  const pushEnd = pushStart + stageTotal;

  const enterHoldStart = pushEnd;
  const enterHoldEnd = enterHoldStart + BODY_HOLD_TICKS;
  const enterStart = enterHoldEnd;
  const enterEnd = enterStart + ENTER_BODY_TICKS;

  return {
    exitStart,
    exitEnd,
    bodyHoldStart,
    bodyHoldEnd,
    pullStart,
    pullStageTicks: stageTicks,
    pullEnd,
    preTravelWait,
    travelStart,
    travelEnd,
    travelTicks,
    prePushWait,
    pushStart,
    pushStageTicks: [...stageTicks],
    pushEnd,
    enterHoldStart,
    enterHoldEnd,
    enterStart,
    enterEnd,
    totalTicks: enterEnd,
  };
}

/** 运镜总时长。 */
export function transitionTotalTicks(timeline: TransitionTimeline): number {
  return timeline.totalTicks;
}

/** 位移提交的时刻:横越起点(跨维度时即等待段结束)。 */
export function teleportTick(timeline: TransitionTimeline): number {
  return timeline.travelStart;
}

// ─── 相机位姿 ────────────────────────────────────────────────────

/** 一帧的相机位姿。`pitch` 正值向下(与上游一致)。 */
export interface CameraFrame {
  position: Position;
  yaw: number;
  pitch: number;
}

/** 计算一帧所需的场景上下文。 */
export interface TransitionContext {
  /** 起点脚部坐标 */
  startFeet: Position;
  /** 起点眼睛坐标 */
  startEye: Position;
  /** 落点脚部坐标 */
  targetFeet: Position;
  /** 落点眼睛坐标 */
  targetEye: Position;
  /** 起点朝向 */
  startYaw: number;
  startPitch: number;
  /** 落点朝向(入体时转回) */
  targetYaw: number;
  targetPitch: number;
  timeline: TransitionTimeline;
  /** 三段变焦高度,默认 `STAGE_HEIGHTS` */
  stageHeights?: TransitionZoomHeights;
}

/** 取第 index 段的结束 tick。 */
function stageEndTick(
  startTick: number,
  index: number,
  stageTicks: TransitionZoomHeights,
): number {
  let offset = 0;
  for (let i = 0; i <= index; i += 1) offset += stageTicks[i] ?? 0;
  return startTick + offset;
}

/** 拉远段的相机高度(相对起点脚部)。 */
function pullAltitude(context: TransitionContext, frameTick: number): number {
  const heights = context.stageHeights ?? STAGE_HEIGHTS;
  const timeline = context.timeline;
  const start = timeline.pullStart;
  const stageTicks = timeline.pullStageTicks;

  const first = stageEndTick(start, 0, stageTicks);
  const second = stageEndTick(start, 1, stageTicks);
  // 第三段之后一直滑到横越开始(含等待段),所以终点取 travelStart
  const end = timeline.travelStart;
  const firstHeight = heights[0] ?? 0;
  const secondHeight = heights[1] ?? 0;
  const thirdHeight = heights[2] ?? 0;

  if (frameTick < first) {
    const progress = (frameTick - start) / Math.max(1, first - start);
    return firstHeight + stageGlideProgress(progress) * STAGE_GLIDE_HEIGHT;
  }
  if (frameTick < second) {
    const progress = (frameTick - first) / Math.max(1, second - first);
    return secondHeight + stageGlideProgress(progress) * STAGE_GLIDE_HEIGHT;
  }
  const progress = (frameTick - second) / Math.max(1, end - second);
  return thirdHeight + finalGlideProgress(progress) * STAGE_GLIDE_HEIGHT;
}

/** 推近段的相机高度(相对落点脚部)。 */
function pushAltitude(context: TransitionContext, frameTick: number): number {
  const heights = context.stageHeights ?? STAGE_HEIGHTS;
  const timeline = context.timeline;
  const start = timeline.pushStart;
  const stageTicks = timeline.pushStageTicks;

  const first = stageEndTick(start, 0, stageTicks);
  const second = stageEndTick(start, 1, stageTicks);
  const end = timeline.enterHoldStart;
  const firstHeight = heights[0] ?? 0;
  const secondHeight = heights[1] ?? 0;
  const thirdHeight = heights[2] ?? 0;

  if (frameTick < first) {
    const progress = (frameTick - start) / Math.max(1, first - start);
    return (
      thirdHeight + (1 - stageGlideProgress(progress)) * STAGE_GLIDE_HEIGHT
    );
  }
  if (frameTick < second) {
    const progress = (frameTick - first) / Math.max(1, second - first);
    return (
      secondHeight + (1 - stageGlideProgress(progress)) * STAGE_GLIDE_HEIGHT
    );
  }
  const progress = (frameTick - second) / Math.max(1, end - second);
  return firstHeight + (1 - stageGlideProgress(progress)) * STAGE_GLIDE_HEIGHT;
}

/** 在脚部上方指定高度处放相机,并叠加抖动。 */
function topDownFrame(
  feet: Position,
  yaw: number,
  frameTick: number,
  altitude: number,
): CameraFrame {
  const shaken = applyZoomShake(frameTick, yaw, TOP_DOWN_PITCH);
  return {
    position: { x: feet.x, y: feet.y + altitude, z: feet.z },
    yaw: shaken.yaw,
    pitch: shaken.pitch,
  };
}

/**
 * 算出某一 tick 的相机位姿。
 *
 * @param frameTick 相对运镜起点的 tick;超出总时长时按最后一帧处理
 */
export function cameraFrameAt(
  context: TransitionContext,
  frameTick: number,
): CameraFrame {
  const timeline = context.timeline;
  const heights = context.stageHeights ?? STAGE_HEIGHTS;

  // 1) 出体:从眼睛升到脚上方 6 格,同时把视角转到正俯视
  if (frameTick < timeline.exitEnd) {
    const progress = frameTick / EXIT_BODY_TICKS;
    const heightProgress = smoothStep(progress);
    const lookProgress = bodyLookProgress(progress);
    const target: Position = {
      x: context.startFeet.x,
      y: context.startFeet.y + BODY_CAMERA_HEIGHT,
      z: context.startFeet.z,
    };
    return {
      position: lerpPosition(context.startEye, target, heightProgress),
      yaw: context.startYaw,
      pitch:
        context.startPitch +
        (TOP_DOWN_PITCH - context.startPitch) * lookProgress,
    };
  }

  // 2) 出体悬停:继续滑出 BODY_GLIDE_HEIGHT
  if (frameTick < timeline.bodyHoldEnd) {
    const progress = (frameTick - timeline.bodyHoldStart) / BODY_GLIDE_TICKS;
    const altitude =
      BODY_CAMERA_HEIGHT + clamp(progress, 0, 1) * BODY_GLIDE_HEIGHT;
    return topDownFrame(
      context.startFeet,
      context.startYaw,
      frameTick,
      altitude,
    );
  }

  // 3) 拉远三段
  if (frameTick < timeline.pullEnd) {
    return topDownFrame(
      context.startFeet,
      context.startYaw,
      frameTick,
      pullAltitude(context, frameTick),
    );
  }

  // 4) 等待:锁在第三段末的高度
  if (frameTick < timeline.travelStart) {
    return topDownFrame(
      context.startFeet,
      context.startYaw,
      frameTick,
      (heights[2] ?? 0) + STAGE_GLIDE_HEIGHT,
    );
  }

  // 5) 横越(跨维度时该段长度为 0,不会进入)
  if (frameTick < timeline.travelEnd) {
    const progress =
      timeline.travelTicks === 0
        ? 1
        : (frameTick - timeline.travelStart) / timeline.travelTicks;
    const eased = travelEaseProgress(progress, timeline.travelTicks);
    const altitude = (heights[2] ?? 0) + STAGE_GLIDE_HEIGHT;
    const source: Position = {
      x: context.startFeet.x,
      y: context.startFeet.y + altitude,
      z: context.startFeet.z,
    };
    const target: Position = {
      x: context.targetFeet.x,
      y: context.targetFeet.y + altitude,
      z: context.targetFeet.z,
    };
    const shaken = applyZoomShake(frameTick, context.startYaw, TOP_DOWN_PITCH);
    return {
      position: lerpPosition(source, target, eased),
      yaw: shaken.yaw,
      pitch: shaken.pitch,
    };
  }

  // 6) 等待:锁在落点上方的横越高度
  if (frameTick < timeline.pushStart) {
    return topDownFrame(
      context.targetFeet,
      context.startYaw,
      frameTick,
      (heights[2] ?? 0) + STAGE_GLIDE_HEIGHT,
    );
  }

  // 7) 推近三段
  if (frameTick < timeline.pushEnd) {
    return topDownFrame(
      context.targetFeet,
      context.startYaw,
      frameTick,
      pushAltitude(context, frameTick),
    );
  }

  // 8) 入体悬停:从 6 格 + 滑出量收回 6 格
  if (frameTick < timeline.enterHoldEnd) {
    const progress = (frameTick - timeline.enterHoldStart) / BODY_GLIDE_TICKS;
    const altitude =
      BODY_CAMERA_HEIGHT + (1 - clamp(progress, 0, 1)) * BODY_GLIDE_HEIGHT;
    return topDownFrame(
      context.targetFeet,
      context.startYaw,
      frameTick,
      altitude,
    );
  }

  // 9) 入体:从脚上方 6 格降到眼睛,视角转回落点朝向
  const progress = clamp(
    (frameTick - timeline.enterStart) / ENTER_BODY_TICKS,
    0,
    1,
  );
  const heightProgress = smoothStep(progress);
  const lookProgress = bodyLookProgress(progress);
  const source: Position = {
    x: context.targetFeet.x,
    y: context.targetFeet.y + BODY_CAMERA_HEIGHT,
    z: context.targetFeet.z,
  };
  const target: Position = {
    x: context.targetEye.x,
    y: context.targetEye.y,
    z: context.targetEye.z,
  };
  return {
    position: lerpPosition(source, target, heightProgress),
    yaw: lerpDegrees(context.startYaw, context.targetYaw, lookProgress),
    pitch:
      TOP_DOWN_PITCH + (context.targetPitch - TOP_DOWN_PITCH) * lookProgress,
  };
}

// ─── 音效点 ──────────────────────────────────────────────────────

/** 转场音效意图。由适配层映射到具体音效 ID。 */
export type TransitionSoundCue =
  | "exit-body"
  | "pull-stage-1"
  | "pull-stage-2"
  | "pull-stage-3"
  | "travel"
  | "push-stage-2"
  | "push-stage-3"
  | "enter-hold"
  | "enter-body";

/**
 * 判断某一 tick 应播哪个音效;不需要播时返回 undefined。
 *
 * 与上游 `isCameraStepSoundTick` 一致,共 9 个音效点:
 * 出体起点、拉远三段起点、横越起点、推近第 2/3 段起点、
 * 入体悬停起点、入体起点。
 */
export function isCameraStepSoundTick(
  timeline: TransitionTimeline,
  tick: number,
): TransitionSoundCue | undefined {
  const pullTicks = timeline.pullStageTicks;
  const pushTicks = timeline.pushStageTicks;
  const pullFirstLength = pullTicks[0] ?? 0;
  const pullSecondLength = pullTicks[1] ?? 0;
  const pushFirstLength = pushTicks[0] ?? 0;
  const pushSecondLength = pushTicks[1] ?? 0;

  if (tick === timeline.exitStart) return "exit-body";

  // 拉远三段起点:前两段是段首,第三段接在第二段之后
  if (tick === timeline.pullStart) return "pull-stage-1";
  if (tick === timeline.pullStart + pullFirstLength) return "pull-stage-2";
  if (tick === timeline.pullStart + pullFirstLength + pullSecondLength) {
    return "pull-stage-3";
  }

  // 横越起点。推近第 1 段的起点与之相邻(隔一个等待段),
  // 上游不给它单独的音效,避免与横越音效挤在一起
  if (tick === timeline.travelStart) return "travel";

  if (tick === timeline.pushStart + pushFirstLength) return "push-stage-2";
  if (tick === timeline.pushStart + pushFirstLength + pushSecondLength) {
    return "push-stage-3";
  }

  // 入体悬停起点与入体起点
  if (tick === timeline.enterHoldStart) return "enter-hold";
  if (tick === timeline.enterStart) return "enter-body";

  return undefined;
}

// ─── 风格下标互转(管理界面下拉框用)────────────────────────────

/** 下拉框下标 → 风格。非法下标回落默认风格。 */
export function transitionStyleFromIndex(index: unknown): TransitionStyle {
  if (typeof index !== "number" || !isFinite(index)) {
    return DEFAULT_CONFIG.transitionStyle;
  }
  const style = TRANSITION_STYLES[Math.floor(index)];
  return style === undefined ? DEFAULT_CONFIG.transitionStyle : style;
}

/** 风格 → 下拉框下标。 */
export function transitionStyleToIndex(style: TransitionStyle): number {
  const index = TRANSITION_STYLES.indexOf(style);
  return index === -1
    ? TRANSITION_STYLES.indexOf(DEFAULT_CONFIG.transitionStyle)
    : index;
}

// ─── 执行方式分派 ────────────────────────────────────────────────
//
// 把「这次传送该怎么执行」从适配层里抽出来,是因为它有四条分支
// (即时 / 淡入淡出 / 运镜 / 跨维度降档),每条都要能被单独验证。
// 适配层只负责按结果去调对应的副作用函数。

/** 一次传送的执行方式。 */
export type TransitionMode = "immediate" | "fade" | "cinematic";

/** 分派所需的全部输入。 */
export interface TransitionModeInput {
  /** 配置里的风格。`off` / `fade` / `cinematic` */
  style: TransitionStyle;
  /** 起点与落点是否不同维度 */
  crossDimension: boolean;
}

/**
 * 决定这次传送用哪种执行方式。
 *
 * 三条规则,按优先级:
 *   1. 风格为 `off` → 即时位移,不播任何动画
 *   2. 风格为 `fade`,或起点与落点跨维度 → 黑屏淡入淡出
 *   3. 其余 → 电影感运镜
 *
 * 跨维度之所以降档,是因为相机绑定在玩家连接上,玩家换维度时
 * 会被引擎重置,无法做「相机横越维度」。
 */
export function resolveTransitionMode(
  input: TransitionModeInput,
): TransitionMode {
  if (input.style === "off") return "immediate";
  if (input.style === "fade") return "fade";
  if (input.crossDimension) return "fade";
  return "cinematic";
}

// ─── 会话兜底判定 ────────────────────────────────────────────────

/** 兜底检查所需的会话状态。 */
export interface SessionGuardInput {
  /** 玩家句柄是否仍可用 */
  playerUsable: boolean;
  /** 已过的 tick 数 */
  elapsed: number;
  /** 时间轴总时长 */
  totalTicks: number;
}

/** 兜底的超时余量(tick)。 */
export const SESSION_TIMEOUT_MARGIN_TICKS = 20;

/**
 * 会话是否应该被强制结束。
 *
 * 两条判据:玩家句柄失效,或耗时超过「总时长 × 2 + 20」。
 * 没有这条兜底,一次相机异常就会让玩家永久失去移动能力。
 */
export function shouldAbortSession(input: SessionGuardInput): boolean {
  if (!input.playerUsable) return true;
  return input.elapsed > input.totalTicks * 2 + SESSION_TIMEOUT_MARGIN_TICKS;
}
