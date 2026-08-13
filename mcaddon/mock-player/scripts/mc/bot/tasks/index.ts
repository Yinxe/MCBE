// ─── 任务工厂 barrel（mc/bot/tasks） ──────────────────
// **可扩展**：新增复杂任务 = 写一个任务工厂文件（闭包 MockBot 实例，
// 实现 BotTask：start/tick/isDone/cancel）+ 在此导出一行。
// 任务经 MockBot.startTask(task, onComplete?) 挂到假人独立引擎。

export { navigateToTask, type NavigateToTaskOptions } from "./NavigateToTask";
