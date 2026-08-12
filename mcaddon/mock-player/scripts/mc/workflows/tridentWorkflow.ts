// ─── 三叉戟认主工作流（mc/workflows） ──────────────────
// 每个工作流单独一份文件（本目录 = 工作流定义，与 features 功能实现分离）。
// 业务逻辑在 features/tridentTracker.ts（实体追踪/认主恢复/下线回退）与
// tridentClaim.ts（认主操作/UI）：
//   init   = initTridentTracker()——订阅 entitySpawn/entityLoad 标记 + 假人
//            上线/下线自动认主回退（内部自动行为保留，本工作流提供程序化入口）
//   start  = rebindBotTridents（上线/重生恢复认主；程序化调用，幂等）
//   stop   = releaseBotTridents（下线回退第一任；程序化调用，幂等）
//   isRunning = 该假人当前有被追踪的认主三叉戟（countOwnedTridents > 0）
// 对外事件复用领域事件信号：BotWorkflowEvent.tridentClaimed / tridentOwnerChanged
// （与 DomainEvents 同一信号实例，每个事件独立信号）。

import type { Workflow } from "../../core/service/Workflow";
import { botRegistry } from "../bootstrap/context";
import { initTridentTracker, rebindBotTridents, releaseBotTridents, countOwnedTridents } from "../features/tridentTracker";

/** 三叉戟认主工作流：投掷标记 → 实体追踪 → 认主/回退/夺回（事件驱动 + 生命周期壳） */
export const tridentWorkflow: Workflow = {
  name: "trident",
  description: "三叉戟认主：假人投掷三叉戟自动标记归属，上线恢复认主、下线回退第一任",

  init(): void {
    initTridentTracker();
  },

  start(botName?: string): void {
    if (!botName) return;
    const record = botRegistry.get(botName);
    if (!record || record.death || !record.online) return;
    rebindBotTridents(botName); // 幂等：重复调用安全
  },

  stop(botName?: string): void {
    if (!botName) return;
    releaseBotTridents(botName); // 幂等：重复调用安全
  },

  isRunning(botName?: string): boolean {
    if (!botName) return false;
    return countOwnedTridents(botName) > 0;
  },
};
