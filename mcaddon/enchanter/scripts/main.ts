import { system, world } from "@minecraft/server";
import { registerAllCommands } from "./commands/index";

// ── 4 Phase 启动时序 ──────────────────────────────────────────
// Phase 1: 无状态基础设施 — 编译期完成
// Phase 2: 有状态业务逻辑 — 惰性加载
// Phase 3: 注册命令
// Phase 4: 延迟启动

system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event);
});

system.run(() => {
  console.warn("[Enchanter] 高级附魔模组已加载 v0.0.1");
});
