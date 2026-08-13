// ─── 任务：导航到坐标（mc/bot/tasks） ─────────────────
// 经典复杂任务范式：start 一次性下发导航（绝不重复下发——重复会重置路径
// 把假人钉死）→ tick 只算距离 → 到达/超时/实体失效结束。
// 任务完成回调经 MockBot.startTask(task, onComplete) 挂接。

import { Vector3 } from "@minecraft/server";

import { isArrived, isTimedOut, distance } from "../../../core/bot/Navigation";
import type { BotTask } from "../../../core/bot/Engine";
import type { MockBot } from "../MockBot";

/** 导航任务选项 */
export interface NavigateToTaskOptions {
  /** 到达判定距离（格；默认 1.5） */
  arriveDist?: number;
  /** 超时（tick；默认 600 ≈ 30 秒） */
  timeoutTicks?: number;
  /** 到达回调（任务内部判定到达时调用一次） */
  onArrive?: () => void;
}

/**
 * 导航到坐标任务：start 启动导航一次 → 每 tick 距离检查 →
 * 到达（onArrive + 完成）/ 超时 / 实体失效结束。
 * @param bot 假人实例（闭包访问实体）
 * @param target 目标坐标
 */
export function navigateToTask(bot: MockBot, target: Vector3, opts: NavigateToTaskOptions = {}): BotTask {
  const arriveDist = opts.arriveDist ?? 1.5;
  const timeoutTicks = opts.timeoutTicks ?? 600;
  let elapsed = 0;
  let arrived = false;

  return {
    id: "navigate-to",
    start: (): void => {
      const sim = bot.getEntity();
      if (!sim) return;
      try {
        sim.stopMoving();
        sim.navigateToLocation(target, 1);
      } catch (e: any) {
        console.warn(`[MockPlayer] 导航任务启动异常 ${bot.name}: ${e?.message ?? e}`);
      }
    },
    tick: (): void => {
      elapsed++;
      const sim = bot.getEntity();
      if (!sim) return;
      if (isArrived(distance(sim.location, target), arriveDist) && !arrived) {
        arrived = true;
        opts.onArrive?.();
      }
    },
    isDone: (): boolean => {
      if (arrived) return true;
      const sim = bot.getEntity();
      if (!sim) return true; // 实体失效 → 结束（stopNavigation 由下线流程处理）
      return isArrived(distance(sim.location, target), arriveDist) || isTimedOut(elapsed, timeoutTicks);
    },
    cancel: (): void => {
      bot.stopNavigation();
    },
  };
}
