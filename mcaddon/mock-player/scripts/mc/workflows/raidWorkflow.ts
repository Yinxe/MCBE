// ─── 劫掠工作流（mc/workflows） ───────────────────────
// 每个工作流单独一份文件（本目录 = 工作流定义，与 features 功能实现分离）。
// 业务逻辑在 features/raidMode.ts（事件驱动核心），本文件只做生命周期壳：
//   init   = 注册效果/上线/重生监听（worldLoad 后 initAll 调用）
//   start  = 开模式/上线/重生 → 喝第一瓶
//   stop   = 关模式（移除标签即停用）
//   isRunning = 假人带劫掠标签且在线
// 对外事件走领域事件模式（BotWorkflowEvent.raidStarted / raidVictory，
// 每个事件一个独立信号，见 core/events/WorkflowEvents）

import type { Workflow } from "../../core/service/Workflow";
import { botRegistry } from "../bootstrap/context";
import { TAG_RAID_MODE } from "../../core/tags/BotTags";
import { initRaidModeEffects, startRaidMode, disableRaidMode } from "../features/raidMode";

/** 劫掠工作流：喝不祥之瓶 → 袭击 → 胜利 → 下一瓶（事件驱动循环） */
export const raidWorkflow: Workflow = {
  name: "raid-mode",
  description: "劫掠模式：喝不祥之瓶触发袭击，胜利后把村庄英雄叠加给主人并续喝下一瓶",

  init(): void {
    initRaidModeEffects();
  },

  start(botName?: string): void {
    if (!botName) {
      console.warn(`[Workflow] raid-mode start 需要指定假人`);
      return;
    }
    startRaidMode(botName);
  },

  stop(botName?: string): void {
    if (!botName) return;
    const record = botRegistry.get(botName);
    if (!record) return;
    disableRaidMode(botName, record);
  },

  isRunning(botName?: string): boolean {
    if (!botName) return false;
    const record = botRegistry.get(botName);
    return !!record && record.tags.includes(TAG_RAID_MODE.value) && record.online && !record.death;
  },
};
