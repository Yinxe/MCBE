// ─── 钓鱼任务端口实现（legacy/ai，旧树任务适配层） ────────
// 任务型模块的执行层：FishingPorts 的 mc 适配（legacy/ai/FishingTask 声明
// 决策契约）。分层约定：legacy/ai 自含旧引擎（BotBrain 驱动树）+ 任务适配
// （VaultPorts/FishingPorts）；与新版 features/flow（工作流）无关——随旧树架构退役。
//
// 能力复用（不重复实现）：
//   - sense        → findFishingSpots（getBlocks 扫描，半径 30）
//   - 点位判定     → spotAtStand（~11 次 getBlock 轻量判定）
//   - 占用检测     → isSpotOccupiedByEntity / isSpotUsable（任何实体，实时释放）
//   - 钓鱼中查询   → getFishingStatus（鱼钩实体存在性，最准）
//   - 一次钓鱼     → fishOnce（fishingFlow 闭包：抛竿→稳定→监听→收竿→战利品）
//   - 寻路         → 宝库同款链（navigateToLocation 中心点 + isFullPath +
//                    轮询到达/停滞/超时/协程自检）
//   - 就位三检查   → 微调导航 + setBodyRotation（yaw）+ lookAt（瞄准点）
//   - idle 通知    → [模拟玩家][钓鱼] 前缀 + 200 tick 节流（主人不受距离限制）

import { system, world } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { FishingKnowledge, FishingPorts } from "./FishingTask";
import type { FishingSpot } from "../../rules/FishingRules";
import { computeTargetYaw, isYawAligned, YAW_TOLERANCE_DEG } from "../../rules/FishingRules";
import type { Vec3 } from "../../rules/Types";
import { botRegistry } from "../../bootstrap/context";
import { lookAt } from "../../features/basic/PoseGateway";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import {
  findFishingSpots,
  getFishingStatus,
  hasFishingRod,
  isSpotUsable,
  reelFishingRod,
  spotAtStand,
} from "../../features/basic/fishing";
import { fishOnce } from "../../features/flow/fishingFlow";
import { distance3d, horizontalDistance, waitTicks } from "../../features/utils";

// ─── 常量 ────────────────────────────────────────────────

/** 感知扫描半径（格，正方体半边长） */
const SENSE_RADIUS = 30;
/** 导航轮询间隔（tick） */
const NAVIGATE_POLL_TICKS = 10;
/** 导航停滞判定（tick）：距离连续无进展超过该时长 → 放弃（≈10 秒） */
const STALL_TICKS = 200;
/** 导航总超时（tick，≈30 秒，极端兜底） */
const NAVIGATE_TIMEOUT_TICKS = 600;
/** 寻路到达判定（格，目标站立格中心） */
const NAVIGATE_ARRIVE = 2;
/** 就位对齐判定（格，距站立格中心水平距离 ≤ 该值 = 坐标正中心） */
const ALIGN_DISTANCE = 0.8;
/** 微调导航到达判定（格） */
const ALIGN_ARRIVE = 0.8;
/** 微调导航超时（tick） */
const ALIGN_TIMEOUT_TICKS = 100;
/** 通知节流（tick，≈10 秒） */
const NOTIFY_COOLDOWN_TICKS = 200;

// ─── 通知（主人 + 节流） ─────────────────────────────────

const notifyAt = new Map<string, number>();

/** 通知假人主人（[模拟玩家][钓鱼] 前缀 + 详细；节流防刷屏） */
function notifyOwner(botName: string, detail: string): void {
  try {
    const now = system.currentTick;
    const last = notifyAt.get(botName) ?? 0;
    if (now - last < NOTIFY_COOLDOWN_TICKS) return;
    notifyAt.set(botName, now);
    const record = botRegistry.get(botName);
    if (!record?.ownerName) return;
    world
      .getPlayers({ name: record.ownerName })[0]
      ?.sendMessage(`${color.accent}[模拟玩家][钓鱼] ${color.playerName}${botName} ${color.muted}${detail}`);
  } catch {
    /* 通知失败不影响主流程 */
  }
}

// ─── 工具 ────────────────────────────────────────────────

/** 水平距离 */

// ─── 钓鱼点端口实现 ──────────────────────────────────────

export const fishingPorts: FishingPorts = {
  isBotAvailable(botName: string): boolean {
    const record = botRegistry.get(botName);
    return record !== undefined && record.online && !record.death;
  },

  hasRod(botName: string): boolean {
    return hasFishingRod(botName);
  },

  isOnFishingSpot(botName: string): boolean {
    const bot = resolveBotPlayer(botName);
    if (!bot) return false;
    const pos = bot.location;
    return spotAtStand(bot.dimension, { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }) !== undefined;
  },

  currentSpot(botName: string): FishingSpot | undefined {
    const bot = resolveBotPlayer(botName);
    if (!bot) return undefined;
    const pos = bot.location;
    return spotAtStand(bot.dimension, { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
  },

  sense(botName: string): FishingKnowledge {
    const bot = resolveBotPlayer(botName);
    if (!bot) return { hasRod: false, spots: [], position: { x: 0, y: 0, z: 0 } };
    const pos = bot.location;
    const result = findFishingSpots(pos, bot.dimension, SENSE_RADIUS);
    return {
      hasRod: hasFishingRod(botName),
      spots: result.spots,
      reason: result.reason,
      position: pos,
    };
  },

  distanceToSpot(botName: string, stand: Vec3): number {
    const bot = resolveBotPlayer(botName);
    if (!bot) return Infinity;
    return horizontalDistance(bot.location, { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 });
  },

  async navigateToSpot(botName: string, stand: Vec3): Promise<boolean> {
    const bot = resolveBotPlayer(botName);
    if (!bot) return false;
    const navTarget = { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 };
    if (distance3d(bot.location, navTarget) <= NAVIGATE_ARRIVE) return true;
    try {
      bot.stopMoving();
      const result = bot.navigateToLocation(navTarget, 1);
      if (!result.isFullPath) return false; // 无路径 → 放弃换下一个
    } catch {
      return false;
    }
    // 轮询等待到达：停滞判定 + 总超时兜底 + 协程自检（离线/死亡）
    const startTick = system.currentTick;
    let stallCount = 0;
    let lastDist = Infinity;
    while (true) {
      await waitTicks(NAVIGATE_POLL_TICKS);
      if (!fishingPorts.isBotAvailable(botName)) return false;
      const current = resolveBotPlayer(botName);
      if (!current) return false;
      const dist = distance3d(current.location, navTarget);
      if (dist >= lastDist) {
        stallCount++;
        if (stallCount * NAVIGATE_POLL_TICKS >= STALL_TICKS) return false;
      } else {
        stallCount = 0;
      }
      lastDist = dist;
      if (dist <= NAVIGATE_ARRIVE) return true;
      if (system.currentTick - startTick > NAVIGATE_TIMEOUT_TICKS) return false;
    }
  },

  isAligned(botName: string, stand: Vec3): boolean {
    const bot = resolveBotPlayer(botName);
    if (!bot) return false;
    return horizontalDistance(bot.location, { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 }) <= ALIGN_DISTANCE;
  },

  async ensureAimed(botName: string, spot: FishingSpot): Promise<boolean> {
    const bot = resolveBotPlayer(botName);
    if (!bot) return false;
    const center = { x: spot.stand.x + 0.5, y: spot.stand.y, z: spot.stand.z + 0.5 };
    try {
      // ① 坐标正中心：未对齐 → 微调导航（短距离，轮询到对齐或超时）
      if (!fishingPorts.isAligned(botName, spot.stand)) {
        bot.stopMoving();
        bot.navigateToLocation(center, 1);
        const startTick = system.currentTick;
        while (!fishingPorts.isAligned(botName, spot.stand)) {
          await waitTicks(NAVIGATE_POLL_TICKS);
          if (!fishingPorts.isBotAvailable(botName)) return false;
          if (system.currentTick - startTick > ALIGN_TIMEOUT_TICKS) {
            console.warn(`[MockPlayer] fishing ${botName} align timeout, dist=${fishingPorts.distanceToSpot(botName, spot.stand).toFixed(2)}`);
            return false;
          }
        }
        console.warn(`[MockPlayer] fishing ${botName} align: navigated to center`);
      }
      // ② 身体朝向：当前 yaw 与「stand→瞄准点」目标 yaw 差 > 15° → setBodyRotation
      const targetYaw = computeTargetYaw(center, spot.aim.target);
      const currentYaw = bot.getRotation().y;
      if (!isYawAligned(currentYaw, targetYaw, YAW_TOLERANCE_DEG)) {
        bot.setBodyRotation(targetYaw);
        console.warn(`[MockPlayer] fishing ${botName} yaw: ${currentYaw.toFixed(1)} → ${targetYaw.toFixed(1)}`);
      }
      // ③ 视线：lookAt 瞄准点（持续注视）
      lookAt(bot, { x: spot.aim.target.x, y: spot.aim.target.y + 0.5, z: spot.aim.target.z });
      return true;
    } catch (e) {
      console.warn(`[MockPlayer] fishing ${botName} ensureAimed error: ${e}`);
      return false;
    }
  },

  isSpotUsable(botName: string, stand: Vec3): boolean {
    const bot = resolveBotPlayer(botName);
    if (!bot) return false;
    return isSpotUsable(bot.dimension, stand, bot.id);
  },

  isFishing(botName: string): boolean {
    return getFishingStatus(botName) === "fishing";
  },

  async retractHook(botName: string): Promise<void> {
    try {
      await reelFishingRod(botName); // 无钩时 no-hook 拒绝（no-op）
    } catch (e) {
      console.warn(`[MockPlayer] fishing ${botName} retractHook error: ${e}`);
    }
  },

  async fishOnce(botName: string) {
    return fishOnce(botName);
  },

  idle(botName: string, reason: "no-rod" | "no-water" | "no-spot" | "waiting"): void {
    if (reason === "waiting") return; // 静默等待
    const label =
      reason === "no-rod" ? `${color.error}没有鱼竿，请放入背包` : reason === "no-water" ? `${color.error}附近没有水面` : `${color.error}没有找到可用的钓鱼点`;
    notifyOwner(botName, label);
  },
};
