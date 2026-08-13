// ─── 任务：自动跟随（mc/bot/tasks） ──────────────────
// 持续跟随目标玩家：每 FOLLOW_TICK tick 推进一次导航（navigateToEntity
// 周期重下发——移动目标需要持续追踪）；目标离线/超距 → 结束；距离 ≤ STOP_DIST
// → 停止移动（保持跟随关系）。
// ⚠️ 语义保留（对齐原 followMap 引擎）：
//   - 假人离线/死亡不结束任务（跨 offline/online 周期存活，复活后继续跟随）
//   - 记录被删（botManager.remove）任务随实例释放
//   - 投掷三叉戟期间全局暂停（pauseFollow/resumeFollow）

import { Player, world } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { distance } from "../../../core/bot/Navigation";
import type { BotTask } from "../../../core/bot/Engine";
import type { MockBot } from "../MockBot";

/** 每 10 tick 更新一次寻路 */
const FOLLOW_TICK = 10;
/** 距离目标 3 格内停止寻路 */
const STOP_DIST = 3;
/** 超过 128 格停止跟随 */
const MAX_DIST = 128;

/** 全局暂停标志（投掷三叉戟期间暂停所有跟随导航，不删除跟随关系） */
let followPaused = false;

/** 暂停所有假人跟随导航（不删除跟随关系） */
export function pauseFollow(): void {
  followPaused = true;
}

/** 恢复所有假人跟随导航 */
export function resumeFollow(): void {
  followPaused = false;
}

/**
 * 自动跟随任务：持续寻路跟随目标玩家，直到停止跟随或超出范围。
 * @param bot 假人实例（闭包访问实体/记录）
 * @param targetId 目标玩家实体 ID（重启即失效——跟随为临时运行时行为）
 */
export function followTask(bot: MockBot, targetId: string): BotTask {
  let elapsed = 0;
  let stopped = false;

  return {
    id: "follow",
    tick: (): void => {
      elapsed++;
      if (stopped || followPaused) return;
      // 每 FOLLOW_TICK tick 推进一次导航（对齐原引擎频次）
      if (elapsed % FOLLOW_TICK !== 0) return;

      const sim = bot.getEntity();
      // ⚠️ 不下线即删除：跟随关系应存活跨 offline/online 周期（如投掷三叉戟模式切换）
      if (!sim) return;
      // ⚠️ 死亡不删除跟随关系：自动重生假人复活后（playerSpawn 清 death）继续跟随
      if (bot.record.death) return;

      const target = world.getEntity(targetId) as Player | undefined;
      if (!target?.isValid) {
        sim.sendMessage(`${color.error}跟随目标已离线，停止跟随`);
        stopped = true;
        bot.stopNavigation();
        return;
      }

      const dist = distance(sim.location, target.location);
      if (dist > MAX_DIST) {
        sim.sendMessage(`${color.error}距离目标过远，停止跟随`);
        stopped = true;
        bot.stopNavigation();
        return;
      }

      if (dist <= STOP_DIST) {
        bot.stopNavigation();
        return;
      }

      try {
        sim.navigateToEntity(target, 1);
      } catch {
        // 导航失败时静默忽略
      }
    },
    isDone: (): boolean => stopped,
    cancel: (): void => {
      bot.stopNavigation();
    },
  };
}
