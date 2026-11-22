// ─── 传送转场适配层:逐 tick 驱动相机、冻结输入、播放音效 ──────────
//
// 数值行为全部来自 core/transition.ts(纯逻辑、有单测覆盖),本文件只负责:
//   1. 用 system.runInterval 驱动逐 tick 的位姿计算
//   2. 把位姿写进玩家相机
//   3. 管理输入权限、音效、落点区块预加载
//   4. 失败与中断时的清理
//
// ⚠ 相机成员全部标注 "can't be called in restricted-execution mode"。
// 本模块的所有入口都必须从安全上下文进入;playTransition 内部再用
// system.run 兜底一次,确保即使被同步调用也不在只读上下文写相机。

import {
  EasingType,
  InputPermissionCategory,
  system,
  world,
  type Player,
  type Vector3,
} from "@minecraft/server";
import {
  cameraFrameAt,
  computeTransitionLayout,
  isCameraStepSoundTick,
  shouldAbortSession,
  teleportTick,
  travelTicksForDistance,
  type CameraFrame,
  type TransitionContext,
  type TransitionSoundCue,
  type TransitionTimeline,
  type TransitionZoomHeights,
} from "../core/transition";
import type { ModConfig } from "../core/types";
import { eyeOf, feetOf, teleportImmediate } from "./teleportPrimitive";

/** 一个进行中的转场会话。 */
interface TransitionSession {
  player: Player;
  playerId: string;
  context: TransitionContext;
  timeline: TransitionTimeline;
  /** 落点维度 ID;跨维度降档时也用它 */
  targetDimensionId: string;
  /** 本次转场的音效音量 */
  volume: number;
  startTick: number;
  /** 位移是否已提交 */
  committed: boolean;
  /** 本次转场是否成功完成 */
  resolve: (ok: boolean) => void;
  /** 是否已经结束,避免重复清理 */
  finished: boolean;
}

/** 进行中的转场,按玩家 ID 索引。 */
const active = new Map<string, TransitionSession>();

/** 每 tick 的相机插值时长(秒),20 tick/秒。 */
const CAMERA_EASE_SECONDS = 0.05;

/** 音效意图 → 原版音效 ID 与音量倍率。 */
const SOUND_CUES: Record<
  TransitionSoundCue,
  { soundId: string; volumeScale: number }
> = {
  "exit-body": { soundId: "random.levelup", volumeScale: 0.35 },
  "pull-stage-1": { soundId: "random.orb", volumeScale: 0.5 },
  "pull-stage-2": { soundId: "random.orb", volumeScale: 0.5 },
  "pull-stage-3": { soundId: "random.orb", volumeScale: 0.5 },
  travel: { soundId: "mob.endermen.portal", volumeScale: 1 },
  "push-stage-2": { soundId: "random.orb", volumeScale: 0.5 },
  "push-stage-3": { soundId: "random.orb", volumeScale: 0.5 },
  "enter-hold": { soundId: "random.levelup", volumeScale: 0.35 },
  "enter-body": { soundId: "random.levelup", volumeScale: 0.35 },
};

/** 转场的目标描述。 */
export interface TransitionTarget {
  location: Vector3;
  dimensionId: string;
}

/**
 * 播放一次电影感运镜,并在这期间完成位移。
 *
 * 位移提交点固定在横越阶段的第一 tick(见 `teleportTick`),
 * 因此出体、悬停、拉远与等待这几段天然成为落点区块的加载窗口。
 *
 * @returns 传送是否成功。转场被降级时也按实际结果返回
 */
export function playTransition(
  player: Player,
  target: TransitionTarget,
  config: ModConfig,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // 相机写入属受限成员,统一推迟到安全上下文
    system.run(() => {
      startSession(player, target, config, resolve);
    });
  });
}

/** 在安全上下文中创建会话并启动驱动。 */
function startSession(
  player: Player,
  target: TransitionTarget,
  config: ModConfig,
  resolve: (ok: boolean) => void,
): void {
  // 同一玩家再次发起传送:先中止上一次,避免两个驱动同时写相机。
  // 这里 MUST NOT 强制补位移——新的转场会从玩家当前所在位置重新开始,
  // 补位移会把玩家先送到旧目标再送回来。
  const existing = active.get(player.id);
  if (existing !== undefined) {
    finish(existing, false, false);
  }

  const startFeet = feetOf(player);
  const startEye = eyeOf(player);
  const startDimensionId = player.dimension.id;

  const targetFeet: Vector3 = {
    x: target.location.x,
    y: target.location.y,
    z: target.location.z,
  };

  const crossDimension = startDimensionId !== target.dimensionId;
  const distanceTicks = travelTicksForDistance(startFeet, targetFeet);
  const stageTicks = clampStageTicks(config.transitionZoomTicks);
  const stageHeights = clampStageHeights(
    pickStageHeights(config, startDimensionId),
  );

  const timeline = computeTransitionLayout({
    crossDimension,
    distanceTicks,
    stageTicks,
  });

  const context: TransitionContext = {
    startFeet,
    startEye,
    targetFeet,
    // 落点眼睛坐标按落点脚部推算;玩家真正落地后会被下一次入体覆盖
    targetEye: {
      x: targetFeet.x,
      y: targetFeet.y + (startEye.y - startFeet.y),
      z: targetFeet.z,
    },
    startYaw: player.getRotation().y,
    startPitch: player.getRotation().x,
    targetYaw: player.getRotation().y,
    targetPitch: player.getRotation().x,
    timeline,
    stageHeights,
  };

  const session: TransitionSession = {
    player,
    playerId: player.id,
    context,
    timeline,
    targetDimensionId: target.dimensionId,
    volume: config.transitionVolume,
    startTick: system.currentTick,
    committed: false,
    resolve,
    finished: false,
  };

  active.set(player.id, session);

  freezeInput(player);

  driveSession(session);
}

/** 逐 tick 驱动。 */
function driveSession(session: TransitionSession): void {
  const handle = system.runInterval(() => {
    if (session.finished) {
      system.clearRun(handle);
      return;
    }

    const elapsed = system.currentTick - session.startTick;

    // ── 兜底:句柄失效 / 超时
    if (
      shouldAbortSession({
        playerUsable: isUsable(session.player),
        elapsed,
        totalTicks: session.timeline.totalTicks,
      })
    ) {
      finish(session, false, true);
      return;
    }

    // ── 音效点
    const cue = isCameraStepSoundTick(session.timeline, elapsed);
    if (cue !== undefined) {
      playCue(session.player, cue, session.volume);
    }

    // ── 位移提交:横越阶段第一 tick
    if (!session.committed && elapsed >= teleportTick(session.timeline)) {
      commitTeleport(session);
    }

    // ── 写入相机位姿
    // 最后一 tick 单独处理:写最终位姿(progress=1),但不带 easeOptions。
    // 两个坑各自对应一条:
    //   1. 带 easeTime 的写入会被引擎排队到下一 tick 推进;若同一 tick
    //      紧接着 clear(),那条缓动会在 clear 之后生效,把 free 相机
    //      重新挂回去 → 玩家卡在相机位
    //   2. 干脆不写最后一帧,入体会停在离眼睛 0.086 格处 → 末帧不是
    //      落点眼睛位置
    // 因此:末 tick 写一次「无缓动」的精确终态,再由 finish() 交还。
    const isLastTick = elapsed >= session.timeline.totalTicks;
    const frame = cameraFrameAt(session.context, elapsed);
    writeCamera(session.player, frame, !isLastTick);

    // ── 结束
    if (isLastTick) {
      finish(session, session.committed, false);
    }
  }, 1);
}

/** 提交位移。 */
function commitTeleport(session: TransitionSession): void {
  const target = session.context.targetFeet;
  const ok = teleportImmediate(
    session.player,
    target,
    session.targetDimensionId,
  );
  session.committed = ok;

  // 位移后玩家朝向可能被引擎重置,入体段要转回玩家真实朝向
  if (ok && isUsable(session.player)) {
    const rotation = session.player.getRotation();
    session.context.targetYaw = rotation.y;
    session.context.targetPitch = rotation.x;
    const feet = feetOf(session.player);
    session.context.targetEye = eyeOf(session.player);
    session.context.targetFeet = { x: feet.x, y: feet.y, z: feet.z };
  }
}

/**
 * 写入一帧相机位姿。
 *
 * @param eased 是否带 easeOptions。最后一帧必须为 false:带缓动的写入会
 *              被引擎排队到下一 tick,与随后的 clear() 竞争,导致相机被
 *              重新挂上(玩家卡在相机位)。
 */
function writeCamera(player: Player, frame: CameraFrame, eased = true): void {
  try {
    player.camera.setCamera("minecraft:free", {
      location: frame.position,
      rotation: { x: frame.pitch, y: frame.yaw },
      ...(eased
        ? {
            easeOptions: {
              easeTime: CAMERA_EASE_SECONDS,
              easeType: EasingType.Linear,
            },
          }
        : {}),
    });
  } catch {
    // 相机被引擎拒绝时不影响位移本身;下一次 tick 会再试
  }
}

/** 播放一个音效点。 */
function playCue(
  player: Player,
  cue: TransitionSoundCue,
  volume: number,
): void {
  const mapping = SOUND_CUES[cue];
  if (mapping === undefined) return;
  try {
    player.playSound(mapping.soundId, {
      volume: mapping.volumeScale * volume,
    });
  } catch {
    // 音效失败不影响转场
  }
}

/** 冻结玩家的移动与相机输入。 */
function freezeInput(player: Player): void {
  try {
    player.inputPermissions.setPermissionCategory(
      InputPermissionCategory.Movement,
      false,
    );
    player.inputPermissions.setPermissionCategory(
      InputPermissionCategory.Camera,
      false,
    );
  } catch {
    // 输入权限不可写时照常播放运镜,只是玩家仍能操作
  }
}

/** 恢复玩家的移动与相机输入。 */
function unfreezeInput(player: Player): void {
  try {
    player.inputPermissions.setPermissionCategory(
      InputPermissionCategory.Movement,
      true,
    );
    player.inputPermissions.setPermissionCategory(
      InputPermissionCategory.Camera,
      true,
    );
  } catch {
    // 玩家可能已离线
  }
}

/**
 * 结束会话并清理。
 *
 * @param forced 是否由兜底触发。强制结束时若位移尚未提交,补一次位移,
 *               保证「传送不丢」这条契约
 */
function finish(
  session: TransitionSession,
  ok: boolean,
  forced: boolean,
): void {
  if (session.finished) return;
  session.finished = true;

  active.delete(session.playerId);

  // 强制结束时补位移,避免玩家卡在起点
  if (forced && !session.committed && isUsable(session.player)) {
    session.committed = teleportImmediate(
      session.player,
      session.context.targetFeet,
      session.targetDimensionId,
    );
  }

  // 清理 MUST 无条件尝试,不能用 isUsable 包住整个块。
  // 原因:isValid 可能只是瞬时 false(重生中、切换维度中),而输入权限
  // 与相机状态挂在玩家连接上,仍然有效。包住的结果就是「句柄一失效
  // 输入就永久冻结」——玩家直接卡死。相机与输入各自独立容错。
  releaseCamera(session.player);

  unfreezeInput(session.player);

  session.resolve(session.committed);
}

/**
 * 把相机交还给玩家。
 *
 * 为什么要三道:只调 `clear()` 不够——引擎推进已排队的 easeOptions 写入时
 * 会把 free 相机重新挂回去,表现就是「转场结束了但人还在相机位」。因此:
 *   1. 立即 `clear()` 终止当前相机与进行中的缓动
 *   2. 显式 `setDefaultCamera("minecraft:first_person")` 重置预设
 *   3. 下一 tick 再 `clear()` 一次,清掉可能被缓动重新挂上的状态
 */
function releaseCamera(player: Player): void {
  try {
    player.camera.clear();
  } catch {
    // 相机已被引擎回收,或句柄确实失效
  }

  try {
    player.camera.setDefaultCamera("minecraft:first_person");
  } catch {
    // 部分版本/上下文不支持,忽略
  }

  try {
    system.runTimeout(() => {
      try {
        player.camera.clear();
      } catch {
        // 玩家已离线
      }
    }, 1);
  } catch {
    // 调度失败时保持已完成的清理
  }
}

/** 玩家句柄是否仍可用。 */
function isUsable(player: Player): boolean {
  try {
    return player.isValid;
  } catch {
    return false;
  }
}

/** 把段时长夹取到合理范围,避免配置被改成 0 或负数。 */
function clampStageTicks(ticks: TransitionZoomHeights): TransitionZoomHeights {
  return [
    Math.max(1, Math.floor(ticks[0] ?? 13)),
    Math.max(1, Math.floor(ticks[1] ?? 13)),
    Math.max(1, Math.floor(ticks[2] ?? 13)),
  ];
}

/** 把段高度夹取到合理范围。 */
function clampStageHeights(
  heights: TransitionZoomHeights,
): TransitionZoomHeights {
  return [
    Math.max(1, heights[0] ?? 20),
    Math.max(1, heights[1] ?? 40),
    Math.max(1, heights[2] ?? 60),
  ];
}

/** 按维度取三段高度。维度无法识别时用主世界那一套。 */
function pickStageHeights(
  config: ModConfig,
  dimensionId: string,
): TransitionZoomHeights {
  const table = config.transitionZoomHeights;
  if (dimensionId === "minecraft:nether") return table.nether;
  if (dimensionId === "minecraft:the_end") return table.end;
  return table.overworld;
}

// ─── 淡入淡出降档 ────────────────────────────────────────────────

/** 淡入淡出的三段时长(秒)。 */
export interface FadeTiming {
  fadeInTime: number;
  holdTime: number;
  fadeOutTime: number;
}

/**
 * 常规淡入淡出:淡入 0.2、保持 0.15、淡出 0.3,合计 0.65 秒。
 *
 * 用于风格为 `fade` 的传送与跨维度传送。
 */
export const NORMAL_FADE_TIMING: FadeTiming = {
  fadeInTime: 0.2,
  holdTime: 0.15,
  fadeOutTime: 0.3,
};

/**
 * 快速淡入:淡入 0.15、保持 0.05、淡出 0.15,合计 0.35 秒。
 *
 * 用于死亡点回传——目标位置往往危险,必须尽快拿回操作权。
 *
 * ⚠ 引擎在三段之和不足 0.5 秒时会把保持段自动补足到 0.5 秒(见
 * `docs/research/bedrock-camera-api.md` §7),所以实际总时长约为 0.5 秒。
 * 这里的设定值只是让三段尽可能短,最终由引擎夹取;这仍然比常规的 0.65 秒
 * 与运镜的 3–5 秒短得多,达到了「尽快恢复操作」的目的。
 */
export const QUICK_FADE_TIMING: FadeTiming = {
  fadeInTime: 0.15,
  holdTime: 0.05,
  fadeOutTime: 0.15,
};

/**
 * 用黑屏淡入淡出完成一次传送。
 *
 * 用于三种场合:风格为 `fade`、**跨维度传送**(相机无法随玩家跨维度存续),
 * 以及**死亡点回传**(目标危险,要尽快拿回操作权)。
 *
 * @param timing 三段时长。缺省为常规时长;死亡点回传由调用方传
 *               `QUICK_FADE_TIMING`
 */
export function playFadeTransition(
  player: Player,
  target: TransitionTarget,
  timing: FadeTiming = NORMAL_FADE_TIMING,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    system.run(() => {
      if (!isUsable(player)) {
        resolve(false);
        return;
      }

      try {
        player.camera.fade({
          fadeColor: { red: 0, green: 0, blue: 0 },
          fadeTime: {
            fadeInTime: timing.fadeInTime,
            holdTime: timing.holdTime,
            fadeOutTime: timing.fadeOutTime,
          },
        });
      } catch {
        // 连淡入淡出都不可用:直接位移,保证传送不丢
        resolve(teleportImmediate(player, target.location, target.dimensionId));
        return;
      }

      // 在 hold 段内完成位移:淡入结束之后、淡出开始之前。
      // hold 段中点能同时避开两端,是最稳的提交点。
      const holdTick = Math.round(
        (timing.fadeInTime + timing.holdTime / 2) * 20,
      );
      system.runTimeout(() => {
        const ok = isUsable(player)
          ? teleportImmediate(player, target.location, target.dimensionId)
          : false;

        // 淡出结束后交还相机
        const clearTick = Math.round(timing.fadeOutTime * 20);
        system.runTimeout(() => {
          if (isUsable(player)) {
            try {
              player.camera.clear();
            } catch {
              // 已离线
            }
          }
          resolve(ok);
        }, clearTick);
      }, holdTick);
    });
  });
}

// ─── 主动清理 ────────────────────────────────────────────────────

/** 中止某个玩家的转场(离线、死亡、被新转场接管时调用)。 */
export function abortTransition(playerId: string): void {
  const session = active.get(playerId);
  if (session === undefined) return;
  finish(session, false, false);
}

/** 是否有进行中的转场。 */
export function isTransitionActive(playerId: string): boolean {
  return active.has(playerId);
}
