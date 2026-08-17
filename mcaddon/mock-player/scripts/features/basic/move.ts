// ─── 移动（导航） ──────────────────────────────────────
// 导航为耗时异步能力：while(true) + await waitTicks 循环监测位置（每 10 tick），
// 位置变化=移动中继续等；连续 1 次（0.5 秒）位置未变（X/Y/Z 完全一致）→ 判定到达/移动超时。
// 多状态返回（不裸 boolean）：调用方/玩家可获知具体失败原因。
// 支持选择性回调（onStart/onMoving/onStuck/onComplete），移动中自动更新假人位置/朝向数据。

import { Vector3 } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { buildLongNavigateWaypoints } from "../../rules/coords/Waypoints";
import { RetryError, retry } from "../../rules/utils/Retry";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { waitTicks, distance3d } from "../utils";
import {
  GRASS_BLOCK_BONUS, isStableBlockType, pickDirectionalStrollPoint, selectStrollTarget, strollWalkValue,
  generateStrollRoute, STROLL_CANDIDATE_SAMPLES, STROLL_DEFAULT_RADIUS, STROLL_DEFAULT_ROUTE_RADIUS,
  STROLL_MIN_DISTANCE, type RandomStrollOptions, type StrollCandidate, type StrollRouteOptions,
} from "../../rules/coords/Stroll";

/** 导航速度 */
const NAVIGATE_SPEED = 1;
/** 寻路最远距离（格，水平）：目标超出此距离直接拒绝（不发起寻路）——
 *  远距离寻路路径长、易卡/超时且消耗大，先拒绝由调用方换近目标 */
const NAV_MAX_DISTANCE = 16;
/** 到达判定距离（格，水平 xz）：静止且距目标水平距离 ≤ 此值视为到达 */
const NAV_ARRIVE_XZ = 1.5;
/** 到达判定 y 容差（格）：|dy| ≤ 4 视为到达——选点/地面修正使目标 y
 *  与假人当前层常有几格差，xz 已到位即算到达（不再因 y 差卡住/原地不动） */
const NAV_ARRIVE_Y_TOLERANCE = 4;
/** 附近容忍半径（格，水平 xz）：nearby=true 时停滞判定改用此半径——
 *  目标被方块阻挡无法精确停靠时，"附近就算成功" */
const NEARBY_ARRIVE_XZ = 1;

/** 到达判定（水平 xz ≤ NAV_ARRIVE_XZ 且 |dy| ≤ NAV_ARRIVE_Y_TOLERANCE）：
 *  导航目标是"站到该位置"——xz 已到位、y 相差不大（上下 4 格内可攀爬/
 *  跳跃落差）即算到达。⚠️ 用户实测（2026-08-17）：选点/地面修正使目标 y
 *  与假人当前层常有差，3D 判定过严导致假人"走不到终点"（卡住/原地不动） */
function arrivedAt(loc: Vector3, target: Vector3): boolean {
  return (
    Math.hypot(loc.x - target.x, loc.z - target.z) <= NAV_ARRIVE_XZ &&
    Math.abs(loc.y - target.y) <= NAV_ARRIVE_Y_TOLERANCE
  );
}

/** 附近容忍判定（nearby=true）：停滞时水平距离 ≤ NEARBY_ARRIVE_XZ（y 容差
 *  内）即算到达——目的地坐标存在方块阻挡、路径失败无法精确停靠时，附近
 *  就算移动成功（用户拍板的独立功能参数，默认关） */
function nearbyArrived(loc: Vector3, target: Vector3): boolean {
  return (
    Math.hypot(loc.x - target.x, loc.z - target.z) <= NEARBY_ARRIVE_XZ &&
    Math.abs(loc.y - target.y) <= NAV_ARRIVE_Y_TOLERANCE
  );
}
/** 位置监测间隔（tick）：每 10 tick 读一次位置 */
const NAV_CHECK_INTERVAL = 10;
/** 静止判定次数：连续 1 次（10tick=0.5 秒）位置未变化（X/Y/Z 完全一致）→ 视为假人已停下 */
const NAV_STILL_LIMIT = 1;
/** 总时长超时（tick）：30 秒仍在移动但未到达 → 超时失败 */
const NAV_TOTAL_TIMEOUT_TICKS = 600;
/** 长途段尾提前切换距离（格）：距段尾 ≤ 此值且仍在移动 → 直接发起下一段导航
 *  （无缝转向；须 > 单监测间隔位移 ≈ 2-3 格，防监测间隔内越过段尾） */
const NAV_SEGMENT_SWITCH_DISTANCE = 4;
/** 长途每段超时（tick）：单段 20 秒（重试各自计时） */
const LONG_NAV_SEGMENT_TIMEOUT_TICKS = 400;
/** 长途单段最多重试次数（用户规格：长距离移动小差错容错——最多重试 3 次） */
const LONG_NAV_SEGMENT_RETRY_ATTEMPTS = 3;
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
 * @param nearby 附近容忍（独立功能参数，默认 false）：停滞时水平距离 ≤1 格
 *      即算移动成功——目的地坐标存在方块阻挡、路径失败无法精确停靠时用
 * @returns 多状态结果（见 NavigateResult 枚举），永不 reject
 */
export async function navigateBot(
  botName: string,
  target: Vector3,
  speed = NAVIGATE_SPEED,
  callbacks?: NavigateCallbacks,
  nearby = false,
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
  while (true) {
    await waitTicks(NAV_CHECK_INTERVAL);
    elapsed += NAV_CHECK_INTERVAL;
    try {
      // ⚠️ 实体有效性防护：死亡/下线瞬间实体失效
      if (!bot.isValid) {
        callbacks?.onComplete?.(NavigateResult.EntityInvalid);
        return NavigateResult.EntityInvalid;
      }

      const loc = bot.location;

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
          // 0.5 秒内位置未变化 → 假人已停下：到达判定（水平 + y 容差）=
          //  已到达；nearby=true 用附近容忍半径（目标被阻挡时附近即成功）；
          // 否则 = 移动超时（卡住）
          const result = (nearby ? nearbyArrived(loc, target) : arrivedAt(loc, target))
            ? NavigateResult.Arrived
            : NavigateResult.StillTimeout;
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

/** 单段执行结果（可重试的失败原因） */
type SegmentOutcome = "ok" | "no-path" | "still-timeout" | "timeout" | "entity-invalid" | "error";

/**
 * 执行单段导航并监测至段完成（异步；每段独立计时）。
 * 非末段：距段尾 ≤ 切换距离即成功（假人仍在移动——外层无缝进入下一段）；
 * 末段：静止且距目标 ≤ 到达距离才算到达（nearby=true 用附近容忍半径）。
 * 失败原因：无路径 / 停滞未达切换点 / 段超时 / 实体失效 / 监测异常。
 */
async function runSegment(
  bot: SimulatedPlayer,
  botName: string,
  waypoint: Vector3,
  speed: number,
  isLast: boolean,
  callbacks?: NavigateCallbacks,
  nearby = false,
): Promise<SegmentOutcome> {
  // 实体有效性（重试时立即返回，不发起导航）
  if (!bot.isValid) return "entity-invalid";
  // 发起导航（引擎导航覆盖当前移动——段间切换/重试均无缝，不 stopMoving）
  try {
    const result = bot.navigateToLocation(waypoint, speed);
    if (!result.isFullPath) return "no-path";
  } catch (e: any) {
    console.warn(`[MockPlayer] longNavigateBot 发起失败 ${botName}: ${e?.message ?? e}`);
    return "no-path";
  }

  let lastLoc = bot.location;
  let stillCount = 0;
  let elapsed = 0;
  while (true) {
    await waitTicks(NAV_CHECK_INTERVAL);
    elapsed += NAV_CHECK_INTERVAL;
    try {
      if (!bot.isValid) return "entity-invalid";
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

      // 段尾提前切换：距段尾水平距离 ≤ 切换距离（y 容差内）且还在移动中即
      // 成功（外层直接发起下一段导航无缝转向）
      const nearWaypoint = Math.hypot(loc.x - waypoint.x, loc.z - waypoint.z) <= NAV_SEGMENT_SWITCH_DISTANCE &&
        Math.abs(loc.y - waypoint.y) <= NAV_ARRIVE_Y_TOLERANCE;
      if (!isLast && nearWaypoint) return "ok";
      if (stillCount >= NAV_STILL_LIMIT) {
        // 假人已停下：末段=到达判定（水平 + y 容差；nearby=true 用附近容忍
        // 半径）；非末段=已在切换距离内仍算成功，否则停滞失败
        if (isLast) return (nearby ? nearbyArrived(loc, waypoint) : arrivedAt(loc, waypoint)) ? "ok" : "still-timeout";
        if (nearWaypoint) return "ok";
        return "still-timeout";
      }
      if (elapsed >= LONG_NAV_SEGMENT_TIMEOUT_TICKS) return "timeout";
    } catch (e: any) {
      console.warn(`[MockPlayer] longNavigateBot 监测异常 ${botName}: ${e?.message ?? e}`);
      return "error";
    }
  }
}

/** 段失败原因 → 导航结果（外层收口） */
const SEGMENT_OUTCOME_TO_RESULT: Record<Exclude<SegmentOutcome, "ok">, NavigateResult> = {
  "no-path": NavigateResult.NoPath,
  "still-timeout": NavigateResult.StillTimeout,
  timeout: NavigateResult.Timeout,
  "entity-invalid": NavigateResult.EntityInvalid,
  error: NavigateResult.Error,
};

/**
 * 长途寻路（分段接力，可移动远超 16 格；段间零间停；小差错容错重试）。
 * 官方 API（navigateToLocation）无距离上限参数、远距离导航易失败/卡死——
 * 本函数把目标路径按 16 格水平等分切段（buildLongNavigateWaypoints），
 * 逐段执行 runSegment：**段尾提前切换**——假人距段尾 ≤ 切换距离且仍在移动时
 * 即成功，立即发起下一段导航（引擎导航覆盖当前移动，无缝转向，不 stopMoving）。
 * 每段失败（无路径/停滞/超时等长距离移动小差错）经 retry 重试，最多 3 次。
 *
 * @param botName 假人名
 * @param target 长途目标（可远超 16 格）
 * @param speed 导航速度（缺省 1）
 * @param callbacks 移动过程回调（onStart 触发一次；onMoving/onStuck 全程透传；
 *                  onComplete 整体收口）
 * @param nearby 附近容忍（独立功能参数，默认 false）：段末停滞时水平距离
 *      ≤1 格即算段成功——目的地坐标被方块阻挡无法精确停靠时用
 * @returns NavigateResult：arrived（全部段完成）/ 失败原因
 *          （no-path / still-timeout / timeout / unavailable / entity-invalid / error）
 * @throws 永不 reject（异常归 error）
 */
export async function longNavigateBot(
  botName: string,
  target: Vector3,
  speed = NAVIGATE_SPEED,
  callbacks?: NavigateCallbacks,
  nearby = false,
): Promise<NavigateResult> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return NavigateResult.Unavailable;

  const waypoints = buildLongNavigateWaypoints(bot.location, target);
  // 单段（≤16 格）：与短程寻路等价（复用其到达/停滞语义）
  if (waypoints.length === 1) return navigateBot(botName, target, speed, callbacks, nearby);

  // 初始朝向（段间切换/重试不 stopMoving——引擎覆盖当前移动保持无缝）
  try {
    bot.stopMoving();
    bot.lookAtLocation(waypoints[0]!);
  } catch {
    /* lookAt 失败不影响移动 */
  }
  callbacks?.onStart?.();

  let outcome: SegmentOutcome = "ok";
  for (let seg = 0; seg < waypoints.length; seg++) {
    const isLast = seg === waypoints.length - 1;
    try {
      // ⚠️ 容错：长距离移动小差错（无路径/停滞/超时）经 retry 重试，最多 3 次
      outcome = await retry(
        () => runSegment(bot, botName, waypoints[seg]!, speed, isLast, callbacks, nearby),
        {
          attempts: LONG_NAV_SEGMENT_RETRY_ATTEMPTS,
          isSuccess: (r) => r === "ok",
          onRetry: (attempt, _err, lastResult) => {
            console.warn(
              `[MockPlayer] 长途寻路 ${botName} 第 ${seg + 1}/${waypoints.length} 段失败（${String(lastResult)}），` +
                `重试 ${attempt}/${LONG_NAV_SEGMENT_RETRY_ATTEMPTS}`,
            );
          },
        },
      );
    } catch (e: unknown) {
      // retry 耗尽（抛 RetryError）：取最后一次失败原因
      outcome = e instanceof RetryError ? ((e.lastResult as SegmentOutcome) ?? "error") : "error";
    }
    if (outcome !== "ok") break;
  }

  if (outcome === "ok") {
    callbacks?.onComplete?.(NavigateResult.Arrived);
    return NavigateResult.Arrived;
  }
  const result = SEGMENT_OUTCOME_TO_RESULT[outcome as Exclude<SegmentOutcome, "ok">];
  callbacks?.onComplete?.(result);
  return result;
}

// ─── 单次随机游走（移动功能模块） ─────────────────────
// 官方 wiki 陆地目标算法（寻路页随机游走节）：
//   1. 随机挑选 10 个位置（水平半径 + 高度范围随机方向）
//   2. 筛选：下方必须是**稳定方块**（遮挡形状完整——台阶/楼梯/玻璃等
//      黑名单排除）；目标为固体 → 高度向上修正到非固体；修正后为水 → 无效
//   3. 挑选**行走目标值最大**的位置作为终点（位置值 i/(60-3i)-0.5
//      光照单调递增 + 草方块偏好 10）
// 决策核心（selectStrollTarget/稳定方块/行走目标值）在 rules/coords/Stroll
// 纯逻辑可单测；本函数做世界查询（getBlock）采样 10 个候选并导航。
// 持续游走由生物 AI 能力（features/ai/capabilities/wander）周期性调用。

/** 最大修正高度（格）：固体向上修正上限，防死循环 */
const STROLL_MAX_RAISE = 8;

/**
 * 可站立修正（mc 层世界查询；单点/路线游走共用）：
 * 从**当前地面层起**找"可站立点"：非固体 且 下方是稳定方块（遮挡形状
 * 完整）且 非水——目标点保证站在真实地面上（消除悬空点导致的 no-path）。
 * 返回修正后目标点 + 行走目标值（官方偏好；路线模式只用点）。
 * 无有效候选 → undefined。
 */
function resolveStandableStrollPoint(bot: SimulatedPlayer, candidate: Vector3): StrollCandidate | undefined {
  const x = Math.floor(candidate.x);
  const z = Math.floor(candidate.z);
  const baseY = Math.floor(bot.location.y); // 从当前地面层起（不随机高度偏移——偏移会产生悬空点）
  let y = baseY;
  try {
    const dim = bot.dimension;
    // 从当前层向上找"可站立点"：非固体 + 下方稳定方块（遮挡形状完整）
    while (y - baseY <= STROLL_MAX_RAISE) {
      const head = dim.getBlock({ x, y, z });
      if (!head) return undefined;
      if (!head.isAir && head.typeId !== "minecraft:cave_air") {
        // 目标位置为固体：液体提前无效，否则向上修正（官方陆地目标算法）
        if (head.isLiquid) return undefined;
        y++;
        continue;
      }
      // 非固体：确认下方是稳定方块（可站立）——否则悬空，继续向上
      const below = dim.getBlock({ x, y: y - 1, z });
      if (below && !below.isAir && !below.isLiquid && isStableBlockType(below.typeId)) {
        // 行走目标值：官方位置值（内部光照单调递增）+ 草方块偏好（动物语义 +10）
        let walkValue = -0.5;
        try {
          walkValue = strollWalkValue(head.getLightLevel());
        } catch {
          /* 光照读取失败：按全暗位置值 */
        }
        if (below.typeId === "minecraft:grass_block") walkValue += GRASS_BLOCK_BONUS;
        return { point: { x: x + 0.5, y, z: z + 0.5 }, walkValue };
      }
      y++;
    }
    return undefined; // 超修正上限：无可站立点
  } catch {
    return undefined; // 区块未加载/越界 → 无效候选
  }
}

/**
 * 单次候选采样（官方陆地目标算法一步，地面性修复版）：
 * 随机方向（朝向偏置）→ 可站立修正。选点距离 ∈ [minDist, radius]
 * （minDist 排除过近点——原地踱步不自然）。无有效候选 → undefined
 * （调用方凑满 10 个候选后选偏好最大者）。
 */
function sampleStrollCandidate(
  bot: SimulatedPlayer,
  radius: number,
  yawDeg: number,
  minDist: number,
): StrollCandidate | undefined {
  // 随机方向：朝向偏置（六成概率朝当前转身方向——官方随机视角带动游走方向）
  const point = pickDirectionalStrollPoint(bot.location, yawDeg, radius, undefined, undefined, undefined, minDist);
  return resolveStandableStrollPoint(bot, point);
}

/**
 * 单次随机游走：官方陆地目标算法选点（10 候选选行走目标值最大者）→
 * 单次导航（≤16 格直达）。
 * @param botName 假人名
 * @param options 半径/速度（速度可传慢速如 0.6——散步语义）
 * @returns 导航结果（arrived/失败原因；永不 reject）
 */
export async function randomStrollOnce(botName: string, options: RandomStrollOptions = {}): Promise<NavigateResult> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return NavigateResult.Unavailable;
  // 10 候选采样 → 选行走目标值最大者（官方陆地目标算法）
  const radius = options.radius ?? STROLL_DEFAULT_RADIUS;
  const minDist = options.minDist ?? STROLL_MIN_DISTANCE;
  const yawDeg = bot.getRotation().y; // 当前朝向（转身/扭头后即新朝向——带动游走方向）
  const samples: (StrollCandidate | undefined)[] = [];
  for (let i = 0; i < STROLL_CANDIDATE_SAMPLES; i++) {
    samples.push(sampleStrollCandidate(bot, radius, yawDeg, minDist));
  }
  const target = selectStrollTarget(samples);
  if (!target) return NavigateResult.NoPath; // 周围无可站立近点
  return navigateBot(botName, target, options.speed ?? NAVIGATE_SPEED);
}

/**
 * 单次随机游走路线（路线模式：每次游走 1~3 个路径点，总范围 radius 圆内，
 * 方向顺延不折返）：生成路线 → 逐点可站立修正（修正失败的点丢弃，全丢 =
 * 无可站立点）→ 依次导航（longNavigateBot 段切处理可覆盖任意点间距）。
 * 任一路径点失败 → 本次路线中止返回该失败原因（wander 按失败快速重试，
 * 不进入长休息）。
 * @param botName 假人名
 * @param options 总范围半径/最小距离/点数上下限/速度（透传路线生成）
 * @returns 导航结果（arrived/中途失败原因；永不 reject）
 */
export async function randomStrollRouteOnce(
  botName: string,
  options: RandomStrollOptions & StrollRouteOptions = {},
): Promise<NavigateResult> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return NavigateResult.Unavailable;
  // 路线生成（纯逻辑：0~3 点，总范围 radius 圆内；方向顺延不折返）
  const route = generateStrollRoute(bot.location, bot.getRotation().y, {
    radius: options.radius ?? STROLL_DEFAULT_ROUTE_RADIUS,
    minDist: options.minDist,
    pointMin: options.pointMin,
    pointMax: options.pointMax,
  });
  // 生成 0 个路径点 = 本次保持不动（用户拍板：直接视为完成——wander 走休息）
  if (route.length === 0) return NavigateResult.Arrived;
  // 逐点可站立修正（丢弃修正失败的点——保证导航终点真实可站立）
  const standable: Vector3[] = [];
  for (const p of route) {
    const fixed = resolveStandableStrollPoint(bot, p);
    if (fixed) standable.push(fixed.point);
  }
  if (standable.length === 0) return NavigateResult.NoPath; // 有生成但全修正失败 → 快速重试
  // 依次导航：任一点失败 → 本次路线中止（walk 快速重试）
  for (const point of standable) {
    const r = await longNavigateBot(botName, point, options.speed ?? NAVIGATE_SPEED);
    if (r !== NavigateResult.Arrived) return r;
  }
  return NavigateResult.Arrived;
}
