// ─── 寻路跟随 ──────────────────────────────────────────
// 让假人持续寻路跟随目标玩家，直到停止跟随或超出范围

import { Player, system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry, resolveBotPlayer } from "./core/persistence";

// ─── 跟随状态 ──────────────────────────────────────────
// Map<假人名, 目标玩家 ID> 跟踪当前跟随关系

const followMap = new Map<string, string>();

const FOLLOW_TICK = 10; // 每 10 tick 更新一次寻路
const STOP_DIST = 3;    // 距离目标 3 格内停止寻路
const MAX_DIST = 128;   // 超过 128 格停止跟随

// ─── 公开 API ──────────────────────────────────────────

/**
 * 让假人开始跟随目标玩家。
 * @returns 是否成功启动
 */
export function startFollow(botName: string, targetId: string): boolean {
  if (!botRegistry.has(botName)) return false;
  followMap.set(botName, targetId);
  ensureEngine();
  return true;
}

/**
 * 停止假人跟随。
 */
export function stopFollow(botName: string): void {
  followMap.delete(botName);
  const entity = resolveBotPlayer(botName);
  if (entity) {
    try { entity.stopMoving(); } catch { /* ignore */ }
  }
}

/**
 * 检查假人是否正在跟随。
 */
export function isFollowing(botName: string): boolean {
  return followMap.has(botName);
}

// ─── 内部 ──────────────────────────────────────────────

let followIntervalId: number | undefined;

function ensureEngine(): void {
  if (followIntervalId !== undefined) return;
  followIntervalId = system.runInterval(() => {
    if (followMap.size === 0) {
      // 没有跟随关系，停止引擎
      system.clearRun(followIntervalId!);
      followIntervalId = undefined;
      return;
    }

    for (const [botName, targetId] of followMap) {
      const record = botRegistry.get(botName);
      if (!record) { followMap.delete(botName); continue; }

      const bot = resolveBotPlayer(botName);
      // ⚠️ 不下线即删除：跟随关系应存活跨 offline/online 周期（如投掷三叉戟模式切换）
      if (!bot) {
        // 仅当记录也被删除时才清除跟随关系
        if (!botRegistry.has(botName)) followMap.delete(botName);
        continue;
      }

      if (record.death) {
        followMap.delete(botName);
        try { bot.stopMoving(); } catch { /* ignore */ }
        continue;
      }

      const target = world.getEntity(targetId) as Player | undefined;
      if (!target?.isValid) {
        bot.sendMessage("§c跟随目标已离线，停止跟随");
        try { bot.stopMoving(); } catch { /* ignore */ }
        followMap.delete(botName);
        continue;
      }

      // 计算距离
      const d = {
        x: bot.location.x - target.location.x,
        y: bot.location.y - target.location.y,
        z: bot.location.z - target.location.z,
      };
      const dist = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);

      if (dist > MAX_DIST) {
        bot.sendMessage("§c距离目标过远，停止跟随");
        try { bot.stopMoving(); } catch { /* ignore */ }
        followMap.delete(botName);
        continue;
      }

      if (dist <= STOP_DIST) {
        try { bot.stopMoving(); } catch { /* ignore */ }
        continue;
      }

      try {
        bot.navigateToEntity(target, 1);
      } catch {
        // 导航失败时静默忽略
      }
    }
  }, FOLLOW_TICK);
}
