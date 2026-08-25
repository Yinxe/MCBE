// ─── MockPlayer 入口：4 Phase 启动装配（DI 组合根） ────
// 只做三件事：构造基础设施 → 注册命令/事件 → 延迟启动。
// 业务逻辑全部在 core（零 mcapi，可单测）与 mc/features（副作用）里，
// 本文件不含具体业务，只按依赖顺序手工装配：
//   Phase 1 无状态基础设施 —— mc/bootstrap/context 装配 botRegistry（内存 + DP 持久化）
//   Phase 2 有状态业务 —— （core 服务均为构造注入，无状态容器）
//   Phase 3 注册副作用 —— startup 注册自定义命令（early-execution mode）
//   Phase 4 延迟启动 —— worldLoad 后：GameTest 上下文 → 事件订阅 → 恢复持久化
//             → 行为引擎 → 三叉戟认主机制 → 工作流（劫掠/宝库）
//
// 依赖注入贯穿始终：core 服务以构造函数收依赖（测试用 InMemory 替身），
// mc 层经 bootstrap/context 持有单例。

import { system, world } from "@minecraft/server";

import { registerAllCommands } from "./interaction/commands";
import { registerAllEvents } from "./events/index";
import { startTagBehaviors } from "./features/state/behavior";
import { initPositionTracker } from "./features/basic/PositionTracker";
import { initTridentTracker } from "./features/trident/tridentTracker";
import { initFishingHookTracker, initLootTracker } from "./features/flow";
import { initRaidMode } from "./features/flow/raidMode";
import { startBrainEngine } from "./legacy/ai/BotBrain";
import { startAiEngine } from "./features/ai/brainEngine";
import { startSharedMemorySweeper } from "./features/ai/brainEngine";
import { registerTestDimension } from "./features/manage/gametestContext";
import { initWorldLoad } from "./bootstrap/worldLoad";

// Phase 1/2: 基础设施与业务装配在 mc/bootstrap/context 模块 import 时完成
// （botStore = DynamicProperty 后端，botRegistry = 内存注册表 + 写穿持久化）

// Phase 3: 命令注册（early-execution mode）
// customCommandRegistry 不在 world 上，而是在 StartupEvent 上
// 必须在 early-execution mode 中注册

system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event);
  // 测试维度保留：木桶阵列在 mockplayer:test 16,0,16，需注册维度；GameTest 装置本身禁用
  registerTestDimension(event);
});

// Phase 4: 世界加载装配（仅调用 bootstrap/worldLoad，不含业务）
initWorldLoad();
