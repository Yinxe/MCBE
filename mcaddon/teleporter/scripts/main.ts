import { world, system } from "@minecraft/server";
import { registerAllCommands } from "./commands/index";
import { registerAllEvents } from "./events/index";

// ── 4 Phase 启动时序 ──────────────────────────────────────────
// Phase 1: 无状态基础设施（类型定义、工具函数）
//    → TypeScript 编译期已完成
// Phase 2: 有状态业务逻辑（持久化恢复）
//    → 惰性加载，首次访问时自动从 DynamicProperty 读取
// Phase 3: 注册事件和命令
// Phase 4: 延迟启动

system.beforeEvents.startup.subscribe((event) => {
  // Phase 3: 注册命令和事件
  registerAllCommands(event);
  registerAllEvents();
});

system.run(() => {
  // Phase 4: 延迟启动
  console.warn("[Teleporter] 传送模组已加载 v0.0.1");
});
