// ─── 移动（导航） ──────────────────────────────────────
// 导航为耗时异步能力：while(true) + await waitTicks 循环监测位置（每 10 tick），
// 位置变化=移动中继续等；连续 1 次（0.5 秒）位置未变（X/Y/Z 完全一致）→ 判定到达/移动超时。
// 多状态返回（不裸 boolean）：调用方/玩家可获知具体失败原因。
// 支持选择性回调（onStart/onMoving/onStuck/onComplete），移动中自动更新假人位置/朝向数据。

import { Vector3 } from "@minecraft/server";

import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { waitTicks, distance3d } from "../utils";

/** 导航速度 */
const NAVIGATE_SPEED = 1;
/** 到达判定距离（格）：静止且距目标 ≤ 此值视为到达 */
const NAV_ARRIVE_DISTANCE = 1.5;
/** 位置监测间隔（tick）：每 10 tick 读一次位置 */
const NAV_CHECK_INTERVAL = 10;
/** 静止判定次数：连续 1 次（10tick=0.5 秒）位置未变化（X/Y/Z 完全一致）→ 视为假人已停下 */
const NAV_STILL_LIMIT = 1;
/** 总时长超时（tick）：30 秒仍在移动但未到达 → 超时失败 */
const NAV_TOTAL_TIMEOUT_TICKS = 600;
/** 位置/朝向数据更新阈值（格）：移动距离超过此值才写 record + 持久化（控制写入频率） */
const NAV_POSITION_UPDATE_DISTANCE = 2;

/** 导航结果枚举（多出口：成功 / 各类失败原因） */
export enum NavigateResult {
  /** 已到达目标（静止且距目标 ≤ 到达距离） */
  Arrived = "arrived",
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
