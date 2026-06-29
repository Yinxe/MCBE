// ─── MockPlayer 入口 ─────────────────────────────────────
// 职责：命令注册 + 持久化恢复 + 启动行为引擎 + 事件监听
//
// 启动流程：
//   1. system.beforeEvents.startup — 注册自定义命令（early-execution mode）
//   2. world.afterEvents.worldLoad  — 恢复持久化 → 启动标签行为引擎 → 注册事件监听
//
// 所有事件订阅委托给 events/index.ts 的 registerAllEvents()
// main.ts 保持最小职责：只做初始化编排，不塞业务逻辑

import { world, system } from "@minecraft/server";

import { registerAllCommands } from "./commands/index";
import { registerAllEvents } from "./events/index";
import { botRegistry, saveBotRecord, loadAllBotRecords } from "./features/persistence";
import { startTagBehaviors } from "./features/behavior";

// ─── 命令注册（early-execution mode） ─────────────────────
// customCommandRegistry 不在 world 上，而是在 StartupEvent 上
// 必须在 early-execution mode 中注册

system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event);
});

// ─── 世界加载：恢复持久化 + 启动引擎 + 注册事件 ─────────
// worldLoad 在 world 完全加载后触发，此时可以安全读写动态属性

world.afterEvents.worldLoad.subscribe(() => {
  // 从 DynamicProperty 加载所有假人记录
  // 重启后所有假人默认为 offline 状态
  const loaded = loadAllBotRecords();
  for (const record of loaded) {
    record.online = false;
    record.death = false;
    record.entityId = undefined;
    botRegistry.set(record.name, record);
    saveBotRecord(record);
  }
  console.warn(`[MockPlayer] 从持久化恢复 ${botRegistry.size} 个模拟玩家记录`);

  // 启动标签行为引擎（自动挖掘/放置/攻击/跳跃/体态控制）
  // 同时启动 100tick 周期持久化（位置/经验/装备栏）
  startTagBehaviors();

  // 注册所有事件监听（玩家加入/离开/死亡/背包变化/交互等）
  registerAllEvents();
});
