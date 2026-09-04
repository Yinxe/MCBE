// ─── 自动跟随任务（natural：阶段机，任务运行时独立调度） ──
// workMode="follow"。两阶段循环：follow（寻路跟随 + 持续注视目标）→
// catchup（近距守候：原地注视待命，目标走远回 follow 追击）。
// 目标离线/超距 → 任务自然完成（TASK_DONE）。
//
// ⚠️ 本任务替代旧 state/follow 的 10 tick 共享轮询引擎（followMap + 常驻
//   runInterval）：跟随目标持久化 record.followTargetId/followTargetName
//   （重启恢复）；每假人独立协程（无共享轮询）；事件驱动启停（工作模式
//   切换/上下线/死亡 → 任务运行时对账）。
// 注视语义保留（用户拍板 BUG2）：移动中与到位停住后都 lookAtEntity 目标
// 玩家（引擎持续追踪实体位置）。
// 投掷三叉戟期间暂停跟随：trident 模块经 pauseFollowTask/resumeFollowTask
// 协作（暂停标志模块级，任务自旋等待不寻路）。

import { world, type Player } from "@minecraft/server";

import { botRegistry, saveCoordinator } from "../../../bootstrap/context";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { lookAtEntity } from "../../basic/PoseGateway";
import { describeError } from "../../../errors";
import type { BotRecord } from "../../../rules/Types";
import { defineLoopTask, TASK_DONE, warnTaskError } from "./spec";

// ─── 配置（tick / 格） ─────────────────────────────────

/** 跟随决策间隔（tick = 0.5 秒；对齐旧引擎 10 tick） */
const FOLLOW_TICKS = 10;
/** 距目标多近停止寻路（格） */
const STOP_DIST = 3;
/** 超过此距离放弃跟随（格） */
const MAX_DIST = 128;
/** 寻路速度 */
const SPEED = 1;
/** 实体瞬态不可用重查间隔（tick） */
const OFFLINE_RECHECK_TICKS = 20;

// ─── 跟随暂停（trident 投掷协作） ──────────────────────

/** 暂停跟随的假人集合（模块级：trident 投掷前挂起，投完恢复） */
const pausedFollowers = new Set<string>();

/**
 * 暂停某假人的跟随任务（投掷三叉戟等占用期）：任务每轮检测到暂停标志
 * → 自旋等待不寻路；恢复后继续跟随。幂等。
 */
export function pauseFollowTask(botName: string): void {
  pausedFollowers.add(botName);
}

/** 恢复某假人的跟随任务（幂等；未暂停无效果） */
export function resumeFollowTask(botName: string): void {
  pausedFollowers.delete(botName);
}

/** 某假人跟随是否处于暂停标志（trident 投掷期查询） */
export function isFollowPaused(botName: string): boolean {
  return pausedFollowers.has(botName);
}

// ─── 目标解析 ──────────────────────────────────────────

/**
 * 解析跟随目标：followTargetId 优先；实体 ID 失效（玩家重连后变化）→
 * 按 followTargetName 重找并回写 record（持久化新 ID）。
 * @returns 目标玩家实体；找不到 → undefined
 */
function resolveFollowTarget(record: BotRecord | undefined): Player | undefined {
  if (!record?.followTargetId) return undefined;

  let target = world.getEntity(record.followTargetId) as Player | undefined;
  if (!target?.isValid && record.followTargetName) {
    // ID 失效：按名重找（玩家重连后实体 ID 变化）——找到则回写新 ID 持久化
    const byName = world.getPlayers({ name: record.followTargetName })[0];
    if (byName?.isValid) {
      record.followTargetId = byName.id;
      saveCoordinator.saveRecord(record, true);
      target = byName;
    }
  }
  return target?.isValid ? target : undefined;
}

/** 两点 3D 距离 */
function dist3d(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 跟随任务共享状态 */
interface FollowData {
  /** 上一轮与目标的 3D 距离（观测用） */
  lastDist?: number;
}

// ─── 任务定义 ──────────────────────────────────────────

/** 自动跟随（自然流程循环）任务 */
export const followTask = defineLoopTask<FollowData>({
  workMode: "follow",
  kind: "natural",
  label: "自动跟随",
  createData: () => ({}),
  initial: "follow",
  cleanup: (ctx) => {
    pausedFollowers.delete(ctx.botName);
    try {
      resolveBotPlayer(ctx.botName)?.stopMoving();
    } catch {
      /* 实体失效忽略 */
    }
  },
  phases: {
    follow: {
      label: "跟随",
      run: async (ctx) => {
        // 投掷协作暂停：自旋等待（不寻路不注视），恢复后继续跟随
        if (pausedFollowers.has(ctx.botName)) {
          await ctx.wait(FOLLOW_TICKS);
          return "follow";
        }
        const record = botRegistry.get(ctx.botName);
        const bot = resolveBotPlayer(ctx.botName);
        const target = resolveFollowTarget(record);
        if (!bot) {
          // 实体瞬态不可用（离线/死亡重连中）：目标记录还在 → 等待回归
          await ctx.wait(OFFLINE_RECHECK_TICKS);
          return "follow";
        }
        if (!target) {
          if (record && !record.followTargetId) {
            // 目标字段尚未写入（UI 行为菜单提交的 system.run 写入与本任务
            // 启动存在毫秒级窗口）：短等重读——不秒退归零（写入马上到）
            await ctx.wait(FOLLOW_TICKS);
            return "follow";
          }
          // 目标在册但彻底不可达（离线且按名找不到）→ 自然完成
          ctx.notify("跟随目标已离线，停止跟随");
          return TASK_DONE;
        }

        const dist = dist3d(bot.location, target.location);
        ctx.data.lastDist = dist;
        if (dist > MAX_DIST) {
          ctx.notify(`距离目标过远（${Math.floor(dist)} 格），停止跟随`);
          return TASK_DONE;
        }
        if (dist > STOP_DIST) {
          try {
            bot.navigateToEntity(target, SPEED);
          } catch (e: unknown) {
            warnTaskError(`跟随寻路失败 ${ctx.botName}`, e);
          }
        } else {
          try {
            bot.stopMoving();
          } catch {
            /* 实体失效忽略 */
          }
        }
        // 注视目标（移动中/停住后都保持看向玩家——用户拍板 BUG2 语义保留）
        void lookAtEntity(bot, target).catch((e: unknown) => {
          console.warn(`[MockPlayer] 跟随注视失败 ${ctx.botName}: ${describeError(e)}`);
        });
        await ctx.wait(FOLLOW_TICKS);
        return dist > STOP_DIST ? "follow" : "catchup";
      },
    },
    catchup: {
      label: "守候",
      run: async (ctx) => {
        const bot = resolveBotPlayer(ctx.botName);
        const target = resolveFollowTarget(botRegistry.get(ctx.botName));
        if (!bot) {
          await ctx.wait(OFFLINE_RECHECK_TICKS);
          return "follow";
        }
        if (!target) {
          ctx.notify("跟随目标已离线，停止跟随");
          return TASK_DONE;
        }
        const dist = dist3d(bot.location, target.location);
        ctx.data.lastDist = dist;
        if (dist > MAX_DIST) {
          ctx.notify(`距离目标过远（${Math.floor(dist)} 格），停止跟随`);
          return TASK_DONE;
        }
        if (dist > STOP_DIST) return "follow"; // 目标走远 → 回追击
        // 近距待命：持续注视目标（停住后保持看向玩家）
        void lookAtEntity(bot, target).catch(() => undefined);
        await ctx.wait(FOLLOW_TICKS);
        return "catchup";
      },
    },
  },
});


