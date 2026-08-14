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

import { registerAllCommands } from "./mc/commands/index";
import { registerAllEvents } from "./mc/events/index";
import { startTagBehaviors } from "./mc/features/behavior";
import { initTridentTracker } from "./mc/features/tridentTracker";
import { initFishingHookTracker } from "./mc/features/fishingHookTracker";
import { initRaidPorts } from "./mc/tasks/McRaidPorts";
import { startBrainEngine } from "./mc/ai/BotBrain";
import { initGameTestContext, registerTestDimension } from "./mc/bootstrap/gametestContext";
import { registerUiDrivers } from "./mc/bootstrap/uiDrivers";
import { runMigrations } from "./mc/bootstrap/migration";
import { botRegistry, configStore } from "./mc/bootstrap/context";

// Phase 1/2: 基础设施与业务装配在 mc/bootstrap/context 模块 import 时完成
// （botStore = DynamicProperty 后端，botRegistry = 内存注册表 + 写穿持久化）

// Phase 3: 命令注册（early-execution mode）
// customCommandRegistry 不在 world 上，而是在 StartupEvent 上
// 必须在 early-execution mode 中注册

system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event);
  // 自定义测试维度必须在 startup 事件注册（early-execution mode）
  registerTestDimension(event);
});

// Phase 4: 世界加载：恢复持久化 + 启动引擎 + 注册事件
// worldLoad 在 world 完全加载后触发，此时可以安全读写动态属性

// ⚠️ 幂等守卫：同 runtime 内 worldLoad 可能触发多次（换世界不重启脚本/部分版本重载），
// 重复执行会叠加注册全部事件/订阅 + 启动第二个行为引擎 + restoreAll 误清在线状态
let worldLoadReady = false;

world.afterEvents.worldLoad.subscribe(() => {
  if (worldLoadReady) {
    console.info(`[MockPlayer] worldLoad 已初始化，跳过重复启动`);
    return;
  }
  worldLoadReady = true;

  // 加载全局配置（默认配额/逐人配额/管理员名单）
  configStore.refresh();

  // 初始化 GameTest（供 chunkload 模式使用）
  initGameTestContext();

  // 注册所有事件监听（玩家加入/离开/死亡/背包变化/交互等）
  console.info(`[MockPlayer] 注册事件`);
  registerAllEvents();

  // 注册 UI 领域事件订阅（各功能模块感知 panelAction / behaviorSubmitted）
  registerUiDrivers();

  // 从 DynamicProperty 加载所有假人记录（重启后默认 offline / 非死亡 / 无实体 ID）
  const restored = botRegistry.restoreAll();
  console.info(`[MockPlayer] 从持久化恢复 ${restored.length} 个模拟玩家记录`);

  // 数据迁移：旧版本（≤1.1.48）升级通道——记录归一化 + 旧 DP 物品 → NBT 存储
  // （必须在 restoreAll 之后：记录已在内存；存储区域此时可注册）
  runMigrations();

  // 启动标签行为引擎（自动挖掘/放置/攻击/跳跃/体态控制）
  // 同时启动 100tick 周期持久化（位置/经验/装备栏）
  console.info(`[MockPlayer] 启动引擎`);
  startTagBehaviors();

  // 初始化三叉戟认主机制（entitySpawn/entityLoad 标记 + 上线夺回/下线回退）——
  // 纯事件驱动的自定义世界机制，独立初始化
  initTridentTracker();

  // 初始化钓鱼钩生成追踪（entitySpawn 监测鱼钩 + 读取主人名字）——
  // 自动钓鱼感知基础，独立初始化
  initFishingHookTracker();

  // 初始化劫掠机制（effectAdd 事件订阅 → 公共信号 + 一次性卡死提醒）——
  // 事件驱动感知喂给 AI 行为树（core/tasks/RaidTask），独立初始化
  initRaidPorts();

  // 启动 AI 行为引擎（宝库/劫掠任务：每 10 tick 驱动各自行为树 + 标签对账）
  startBrainEngine();
});
