// ─── 假人任务清单（flow/tasks barrel + 注册入口） ────────
// workMode → 任务实现的唯一注册点：startBotTaskRuntime 前调用
// registerBotTasks()。任务统一用 defineLoopTask 阶段机声明（spec.ts），
// 类型分三类（详见模块 AGENTS.md）：
//   timed   定时触发的循环任务——挖掘/放置/攻击
//   event   基于事件的循环任务——劫掠模式（raidMode 自订阅事件，独立模块）
//   natural 基于自然复杂流程的循环任务——闲逛/钓鱼/砍树（阶段机循环）
// follow 由 state/follow 引擎处理；none 为空档——均不注册。

import { taskManager } from "../../../runtime";
import { mineTask } from "./mineTask";
import { placeTask } from "./placeTask";
import { attackTask } from "./attackTask";
import { wanderTask } from "./wanderTask";
import { fishingTask } from "./fishingTask";
import { woodcutTask } from "./woodcutTask";

/** 已实现的全部任务（只读清单，inspect/UI 展示用） */
export const BOT_TASKS = [mineTask, placeTask, attackTask, wanderTask, fishingTask, woodcutTask] as const;

/** 注册全部任务到任务管理器（幂等：重复注册直接抛错，故全程只调一次） */
export function registerBotTasks(): void {
  for (const task of BOT_TASKS) {
    taskManager.register(task);
  }
}

export { mineTask, placeTask, attackTask, wanderTask, fishingTask, woodcutTask };
export {
  defineLoopTask,
  TASK_DONE,
  warnTaskError,
  type LoopTaskSpec,
  type TaskPhase,
  type PhaseContext,
  type GameTaskServices,
} from "./spec";
export { waitTicksCancellable, createThrottledNotifier } from "./loops";
