// ─── 寻路跟随（per-bot FollowTask） ───────────────────
// 让假人持续寻路跟随目标玩家，直到停止跟随或超出范围。
// 1.3.6 重构：全局 followMap + runInterval 引擎 → 每假人独立 FollowTask
// （挂到 MockBot 独立引擎，由 BotManager 驱动器推进）：
//   - 跟随关系 = 假人实例的活跃任务（activeTaskId === "follow"）
//   - 假人离线/死亡不结束任务（引擎不 tick 但任务存活，跨 offline/online 周期）
//   - 记录被删 → botManager.remove 实例释放 → 任务随释放
//   - 投掷三叉戟期间全局暂停（pauseFollow/resumeFollow 转发自 tasks/FollowTask）

import { Player, system, world } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { BotUiEvent } from "../../core/events/UiEvents";
import { botManager } from "../bot/BotManager";
import { followTask, pauseFollow, resumeFollow } from "../bot/tasks";
import { botRegistry } from "../bootstrap/context";

// ─── 公开 API ──────────────────────────────────────────

/**
 * 让假人开始跟随目标玩家（启动 FollowTask，挂到假人独立引擎）。
 * @returns 是否成功启动（记录存在）
 */
export function startFollow(botName: string, targetId: string): boolean {
  const record = botRegistry.get(botName);
  if (!record) return false;
  const bot = botManager.getOrCreate(record);
  return bot.startTask(followTask(bot, targetId));
}

/**
 * 停止假人跟随（取消 FollowTask；无跟随任务时 no-op）。
 */
export function stopFollow(botName: string): void {
  const bot = botManager.get(botName);
  if (bot && bot.activeTaskId === "follow") {
    bot.cancelTask();
  }
}

/**
 * 检查假人是否正在跟随。
 */
export function isFollowing(botName: string): boolean {
  return botManager.get(botName)?.activeTaskId === "follow";
}

/** 暂停所有假人跟随导航（不删除跟随关系） */
export { pauseFollow };

/** 恢复所有假人跟随导航 */
export { resumeFollow };

/** 返回当前跟随关系数量 */
export function getFollowCount(): number {
  return botManager.all().filter((b) => b.activeTaskId === "follow").length;
}

// ─── UI 事件订阅（行为菜单提交 → 感知跟随开关） ────────

/** 订阅行为菜单提交事件：跟随开关 diff 后启动/停止（record.following 状态，不落标签） */
export function registerUiSubscriptions(): void {
  BotUiEvent.behaviorSubmitted.subscribe((e) => {
    const wantFollow = e.follow;
    if (wantFollow === isFollowing(e.botName)) return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    system.run(() => {
      try {
        if (wantFollow) {
          startFollow(e.botName, player.id);
          player.sendMessage(`${color.success}${color.playerName}${e.botName}${color.success} 正在跟随你`);
        } else {
          stopFollow(e.botName);
          player.sendMessage(`${color.success}${color.playerName}${e.botName}${color.success} 已停止跟随`);
        }
      } catch (err: any) { player.sendMessage(`${color.error}切换跟随失败: ${err?.message ?? err}`); }
    });
  });
}
