import { world, system } from "@minecraft/server";
import { VERSION, BUILD_TIME } from "./version";

// 替换为您的 Add-on 名称
const ADDON_NAME = "my-addon";

/**
 * ============================================================================
 * Main — Add-on 入口
 *
 * 职责概览：
 * 1. 注册自定义命令（system.beforeEvents.startup）
 * 2. 初始化持久化存储（DynamicProperty）
 * 3. 注册事件监听（world.afterEvents / world.beforeEvents）
 * 4. 启动主循环（system.run）
 * ============================================================================
 */

// ── Phase 1: 无状态基础设施 ─────────────────────────────────────
// 在此初始化不依赖运行时状态的服务（配置、日志、存储等）
// const configStore = new ConfigStore();
// const repository = new Repository();

// ── Phase 2: 有状态业务逻辑 ─────────────────────────────────────
// 在此初始化依赖运行时状态的服务
// const service = new MyService(repository, configStore);

// ── Phase 3: 注册事件和命令 ─────────────────────────────────────
system.beforeEvents.startup.subscribe((event) => {
  // 注册自定义命令
  // event.customCommandRegistry.registerCommand(...);
});

// 注册其他事件
// world.afterEvents.playerPlaceBlock.subscribe((event) => { /* ... */ });

// ── Phase 4: 延迟启动 ───────────────────────────────────────────
// world 完全加载后启动定时任务
system.run(() => {
  console.warn(`[${ADDON_NAME}] v${VERSION} loaded (built ${BUILD_TIME})`);
  // scheduler.start();
});

// ── 主循环（可选） ───────────────────────────────────────────────
// function mainTick() {
//   // 在此添加主循环逻辑
//   system.run(mainTick);
// }
// system.run(mainTick);
