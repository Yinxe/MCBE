// ─── Runtime barrel：任务运行时 + 跨假人共享记忆 ─────────

export { SharedMemory, type ExpiryStrategy } from "./SharedMemory";
export {
  taskManager,
  startBotTaskRuntime,
  startSharedMemorySweeper,
  BotTaskManager,
  type BotTask,
  type BotTaskContext,
  type BotTaskKind,
} from "./BotTask";
