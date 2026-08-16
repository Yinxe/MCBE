// ─── 移动（导航） ──────────────────────────────────────
// 导航为耗时异步能力：while(true) + await waitTicks 循环监测位置（每 10 tick），
// 位置变化=移动中继续等；连续 1 次（0.5 秒）位置未变（X/Y/Z 完全一致）→ 判定到达/移动超时。
// 多状态返回（不裸 boolean）：调用方/玩家可获知具体失败原因。
// 支持选择性回调（onStart/onMoving/onStuck/onComplete），移动中自动更新假人位置/朝向数据。

import { Vector3 } from "@minecraft/server";

import { buildLongNavigateWaypoints } from "../../rules/coords/Waypoints";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { waitTicks, distance3d } from "../utils";

/** 导航速度 */
const NAVIGATE_SPEED = 1;
/** 寻路最远距离（格，水平）：目标超出此距离直接拒绝（不发起寻路）——
 *  远距离寻路路径长、易卡/超时且消耗大，先拒绝由调用方换近目标 */
const NAV_MAX_DISTANCE = 16;
/** 到达判定距离（格）：静止且距目标 ≤ 此值视为到达 */
const NAV_ARRIVE_DISTANCE = 1.5;
/** 位置监测间隔（tick）：每 10 tick 读一次位置 */
const NAV_CHECK_INTERVAL = 10;
/** 静止判定次数：连续 1 次（10tick=0.5 秒）位置未变化（X/Y/Z 完全一致）→ 视为假人已停下 */
const NAV_STILL_LIMIT = 1;
/** 总时长超时（tick）：30 秒仍在移动但未到达 → 超时失败 */
const NAV_TOTAL_TIMEOUT_TICKS = 600;
/** 长途段尾提前切换距离（格）：距段尾 ≤ 此值且仍在移动 → 直接发起下一段导航
 *  （无缝转向；须 > 单监测间隔位移 ≈ 2-3 格，防监测间隔内越过段尾） */
const NAV_SEGMENT_SWITCH_DISTANCE = 4;
/** 长途每段超时（tick）：单段 20 秒（总超时 = max(短程 30s, 段数×20s)） */
const LONG_NAV_SEGMENT_TIMEOUT_TICKS = 400;
/** 位置/朝向数据更新阈值（格）：移动距离超过此值才写 record + 持久化（控制写入频率） */
const NAV_POSITION_UPDATE_DISTANCE = 2;

/** 导航结果枚举（多出口：成功 / 各类失败原因） */
export enum NavigateResult {
  /** 已到达目标（静止且距目标 ≤ 到达距离） */
  Arrived = "arrived",
  /** 目标超出寻路最远距离（> 16 格）——直接拒绝，不发起寻路 */
  TooFar = "too-far",
  /** 无路径可达（navigateToLocation 返回 isFullPath=false） */
  NoPath = "no-path",
  /** 移动超时：0.5 秒内位置未变化且未到达（卡住） */
  StillTimeout = "still-timeout",
  /** 总时长超时：30 秒仍在移动但未到达 */
  Timeout = "timeout",
  /** 假人不可用（不在线/死亡/无实体） */
  Unavailable = "unavailable",
  /** 监测中实体失效（死亡/下线） */
  EntityInvalid = "entity-invalid",
  /** 意外异常 */
  Error = "error",
}

/** 移动过程回调（全部可选，按需选择性传参） */
export interface NavigateCallbacks {
  /** 开始移动（寻路已发起成功） */
  onStart?: () => void;
  /** 移动中（每次监测到位置变化；loc = 当前位置） */
  onMoving?: (loc: Vector3) => void;
  /** 停滞（位置未变化；loc = 当前位置，stillCount = 连续未变次数） */
  onStuck?: (loc: Vector3, stillCount: number) => void;
  /** 完成（到达或失败；result = 结果状态） */
  onComplete?: (result: NavigateResult) => void;
}

/** 移动中更新假人位置/朝向数据（record.lastPoint + 持久化，距离阈值控频） */
function updateBotPositionData(botName: string, loc: Vector3, dimensionId: string, rotation: { x: number; y: number }): void {
  try {
    const record = botRegistry.get(botName);
    if (!record) return;
    const last = record.lastPoint;
    // 移动距离未超阈值 → 跳过（避免每 10 tick 写一次 NBT）
    if (last && distance3d(last.location, loc) < NAV_POSITION_UPDATE_DISTANCE) return;
    record.lastPoint = {
      location: loc,
      dimension: dimensionId,
      rotation,
      lookTarget: last?.lookTarget ?? record.respawnPoint.lookTarget,
    };
    saveCoordinator.saveRecord(record, true); // silent：高频移动更新防刷日志
  } catch (e: any) {
    console.warn(`[MockPlayer] navigateBot 位置数据更新失败 ${botName}: ${e?.message ?? e}`);
  }
}

/**
 * 寻路到目标位置并等待完成（闭包异步，多状态返回）。
 * while(true) + await waitTicks(10) 循环监测（不阻塞主线程）：
 *   - 每 10 tick 读取一次位置；位置与上次不同 → 假人仍在移动 → 继续等待
 *   - 连续 1 次（10tick≈0.5 秒）位置未变化 → 假人已停下：
 *     距目标 ≤ 到达距离 = 已到达；否则 = 移动超时（卡住）
 *   - 总时长 30 秒仍在移动但未到达 → 超时失败
 * 移动监听：位置变化时自动更新假人 lastPoint（位置/维度/朝向）+ 持久化（距离阈值控频）。
 * @param callbacks 移动过程回调（onStart/onMoving/onStuck/onComplete，全部可选）
 * @returns 多状态结果（见 NavigateResult 枚举），永不 reject
 */
export async function navigateBot(
  botName: string,
  target: Vector3,
  speed = NAVIGATE_SPEED,
  callbacks?: NavigateCallbacks,
): Promise<NavigateResult> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return NavigateResult.Unavailable;

  // ⚠️ 寻路最远距离：目标超出 16 格（水平）直接拒绝——不发起寻路、不移动
  if (Math.hypot(target.x - bot.location.x, target.z - bot.location.z) > NAV_MAX_DISTANCE) {
    return NavigateResult.TooFar;
  }

  try {
    bot.stopMoving();
    // 开始移动前：让假人看向移动方向的目标坐标点（初始朝向；
    // 寻路自动转向前的朝向同步；看向失败不影响移动）
    try {
      bot.lookAtLocation(target);
    } catch {
      /* lookAt 失败不影响移动 */
    }
    const result = bot.navigateToLocation(target, speed);
    // 无路径可达：直接失败（未开始移动）
    if (!result.isFullPath) return NavigateResult.NoPath;
  } catch (e: any) {
    console.warn(`[MockPlayer] navigateBot 发起失败 ${botName}: ${e?.message ?? e}`);
    return NavigateResult.Error;
  }

  // ── 开始移动回调 ──
  callbacks?.onStart?.();

  // ── 位置监测循环（每 10 tick） ──
  let lastLoc = bot.location;
  let stillCount = 0;
  let elapsed = 0;
  for (;;) {
    await waitTicks(NAV_CHECK_INTERVAL);
    elapsed += NAV_CHECK_INTERVAL;
    try {
      // ⚠️ 实体有效性防护：死亡/下线瞬间实体失效
      if (!bot.isValid) {
        callbacks?.onComplete?.(NavigateResult.EntityInvalid);
        return NavigateResult.EntityInvalid;
      }

      const loc = bot.location;
      const d = distance3d(loc, target);

      if (loc.x !== lastLoc.x || loc.y !== lastLoc.y || loc.z !== lastLoc.z) {
        // 位置变化 → 假人仍在移动 → 重置静止计数，继续等待
        stillCount = 0;
        // 移动监听：更新假人当前位置/朝向数据 + 触发移动中回调
        updateBotPositionData(botName, loc, bot.dimension.id, bot.getRotation());
        callbacks?.onMoving?.(loc);
      } else {
        stillCount++;
        // 停滞回调（位置未变化）
        callbacks?.onStuck?.(loc, stillCount);
        if (stillCount >= NAV_STILL_LIMIT) {
          // 0.5 秒内位置未变化（X/Y/Z 完全一致）→ 假人已停下：近=到达终点，远=移动超时
          const result = d <= NAV_ARRIVE_DISTANCE ? NavigateResult.Arrived : NavigateResult.StillTimeout;
          callbacks?.onComplete?.(result);
          return result;
        }
      }
      lastLoc = loc;

      if (elapsed >= NAV_TOTAL_TIMEOUT_TICKS) {
        callbacks?.onComplete?.(NavigateResult.Timeout);
        return NavigateResult.Timeout;
      }
    } catch (e: any) {
      console.warn(`[MockPlayer] navigateBot 监测异常 ${botName}: ${e?.message ?? e}`);
      callbacks?.onComplete?.(NavigateResult.Error);
      return NavigateResult.Error;
    }
  }
}

/**
 * 长途寻路（分段接力，可移动远超 16 格；段间零间停）。
 * 官方 API（navigateToLocation）无距离上限参数、远距离导航易失败/卡死——
 * 本函数把目标路径按 16 格水平等分切段（buildLongNavigateWaypoints），
 * 单一监测循环逐段推进：**段尾提前切换**——假人距段尾 ≤ 切换距离且仍在移动时，
 * 直接发起下一段导航（引擎导航覆盖当前移动，无缝转向，不 stopMoving 不等待停下）。
 * 最后一段按到达语义收口（静止 + 距目标 ≤ 到达距离）。
 *
 * @param botName 假人名
 * @param target 长途目标（可远超 16 格）
 * @param speed 导航速度（缺省 1）
 * @param callbacks 移动过程回调（onStart 触发一次；onMoving/onStuck 全程透传；
 *                  onComplete 整体收口）
 * @returns NavigateResult：arrived（全部段完成）/ 失败原因
 *          （no-path / still-timeout / timeout / unavailable / entity-invalid / error）
 * @throws 永不 reject（异常归 error）
 */
export async function longNavigateBot(
  botName: string,
  target: Vector3,
  speed = NAVIGATE_SPEED,
  callbacks?: NavigateCallbacks,
): Promise<NavigateResult> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return NavigateResult.Unavailable;

  const waypoints = buildLongNavigateWaypoints(bot.location, target);
  // 单段（≤16 格）：与短程寻路等价（复用其到达/停滞语义）
  if (waypoints.length === 1) return navigateBot(botName, target, speed, callbacks);

  // 发起第一段（初始 stopMoving + 朝向；后续段切换不停止移动）
  const navigateTo = (waypoint: Vector3): boolean => {
    try {
      const result = bot.navigateToLocation(waypoint, speed);
      return result.isFullPath;
    } catch (e: any) {
      console.warn(`[MockPlayer] longNavigateBot 发起失败 ${botName}: ${e?.message ?? e}`);
      return false;
    }
  };
  try {
    bot.stopMoving();
    bot.lookAtLocation(waypoints[0]!);
  } catch {
    /* lookAt 失败不影响移动 */
  }
  if (!navigateTo(waypoints[0]!)) return NavigateResult.NoPath;
  callbacks?.onStart?.();

  // ── 单一监测循环（每 10 tick）：段尾提前切换，最后一段到达收口 ──
  let seg = 0;
  const totalTimeoutTicks = Math.max(NAV_TOTAL_TIMEOUT_TICKS, waypoints.length * LONG_NAV_SEGMENT_TIMEOUT_TICKS);
  let lastLoc = bot.location;
  let stillCount = 0;
  let elapsed = 0;
  for (;;) {
    await waitTicks(NAV_CHECK_INTERVAL);
    elapsed += NAV_CHECK_INTERVAL;
    try {
      // ⚠️ 实体有效性防护：死亡/下线瞬间实体失效
      if (!bot.isValid) {
        callbacks?.onComplete?.(NavigateResult.EntityInvalid);
        return NavigateResult.EntityInvalid;
      }

      const loc = bot.location;
      const moving = loc.x !== lastLoc.x || loc.y !== lastLoc.y || loc.z !== lastLoc.z;
      if (moving) {
        stillCount = 0;
        updateBotPositionData(botName, loc, bot.dimension.id, bot.getRotation());
        callbacks?.onMoving?.(loc);
      } else {
        stillCount++;
        callbacks?.onStuck?.(loc, stillCount);
      }
      lastLoc = loc;

      const dSeg = distance3d(loc, waypoints[seg]!);
      const isLast = seg === waypoints.length - 1;
      if (!isLast && dSeg <= NAV_SEGMENT_SWITCH_DISTANCE) {
        // ⚠️ 段尾提前切换：还在移动中直接发起下一段（引擎覆盖当前移动无缝转向；
        //    不 stopMoving 不等待停下——切换距离 > 单监测间隔位移，防越过段尾）
        seg++;
        if (!navigateTo(waypoints[seg]!)) {
          callbacks?.onComplete?.(NavigateResult.NoPath);
          return NavigateResult.NoPath;
        }
      } else if (stillCount >= NAV_STILL_LIMIT) {
        // 假人已停下：最后一段=到达判定；非末段=停滞失败（或已在切换距离内尝试切换）
        if (isLast) {
          const result = dSeg <= NAV_ARRIVE_DISTANCE ? NavigateResult.Arrived : NavigateResult.StillTimeout;
          callbacks?.onComplete?.(result);
          return result;
        }
        if (dSeg <= NAV_SEGMENT_SWITCH_DISTANCE) {
          seg++;
          if (!navigateTo(waypoints[seg]!)) {
            callbacks?.onComplete?.(NavigateResult.NoPath);
            return NavigateResult.NoPath;
          }
        } else {
          callbacks?.onComplete?.(NavigateResult.StillTimeout);
          return NavigateResult.StillTimeout;
        }
      }

      if (elapsed >= totalTimeoutTicks) {
        callbacks?.onComplete?.(NavigateResult.Timeout);
        return NavigateResult.Timeout;
      }
    } catch (e: any) {
      console.warn(`[MockPlayer] longNavigateBot 监测异常 ${botName}: ${e?.message ?? e}`);
      callbacks?.onComplete?.(NavigateResult.Error);
      return NavigateResult.Error;
    }
  }
}
