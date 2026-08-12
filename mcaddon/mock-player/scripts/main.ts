// ─── MockPlayer 入口：4 Phase 启动装配（DI 组合根） ────
// 只做三件事：构造基础设施 → 注册命令/事件 → 延迟启动。
// 业务逻辑全部在 core（零 mcapi，可单测）与 mc/features（副作用）里，
// 本文件不含具体业务，只按依赖顺序手工装配：
//   Phase 1 无状态基础设施 —— mc/bootstrap/context 装配 botRegistry（内存 + DP 持久化）
//   Phase 2 有状态业务 —— （core 服务均为构造注入，无状态容器）
//   Phase 3 注册副作用 —— startup 注册自定义命令（early-execution mode）
//   Phase 4 延迟启动 —— worldLoad 后：GameTest 上下文 → 事件订阅 → 恢复持久化
//             → 行为引擎 → 三叉戟追踪 → 劫掠事件系统
//
// 依赖注入贯穿始终：core 服务以构造函数收依赖（测试用 InMemory 替身），
// mc 层经 bootstrap/context 持有单例。

import { system, world } from "@minecraft/server";

import { registerAllCommands } from "./mc/commands/index";
import { registerAllEvents } from "./mc/events/index";
import { startTagBehaviors } from "./mc/features/behavior";
import { initGameTestContext } from "./mc/features/gametestContext";
import { initTridentTracker } from "./mc/features/tridentTracker";
import { initRaidModeEffects } from "./mc/features/raidMode";
import { botRegistry } from "./mc/bootstrap/context";

// Phase 1/2: 基础设施与业务装配在 mc/bootstrap/context 模块 import 时完成
// （botStore = DynamicProperty 后端，botRegistry = 内存注册表 + 写穿持久化）

// Phase 3: 命令注册（early-execution mode）
// customCommandRegistry 不在 world 上，而是在 StartupEvent 上
// 必须在 early-execution mode 中注册

system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event);
});

// Phase 4: 世界加载：恢复持久化 + 启动引擎 + 注册事件
// worldLoad 在 world 完全加载后触发，此时可以安全读写动态属性

world.afterEvents.worldLoad.subscribe(() => {
  // 初始化 GameTest（供 chunkload 模式使用）
  initGameTestContext();

  // 注册所有事件监听（玩家加入/离开/死亡/背包变化/交互等）
  console.info(`[MockPlayer] 注册事件`);
  registerAllEvents();

  // 从 DynamicProperty 加载所有假人记录（重启后默认 offline / 非死亡 / 无实体 ID）
  const restored = botRegistry.restoreAll();
  console.info(`[MockPlayer] 从持久化恢复 ${restored.length} 个模拟玩家记录`);

  // 启动标签行为引擎（自动挖掘/放置/攻击/跳跃/体态控制）
  // 同时启动 100tick 周期持久化（位置/经验/装备栏）
  console.info(`[MockPlayer] 启动引擎`);
  startTagBehaviors();

  // 初始化三叉戟追踪（entitySpawn 标记假人抛出的三叉戟）
  console.info(`[MockPlayer] 初始化三叉戟追踪`);
  initTridentTracker();

  // 初始化劫掠事件系统（effectAdd → raidStarted/raidVictory 自定义事件）
  console.info(`[MockPlayer] 初始化劫掠事件系统`);
  initRaidModeEffects();
});
