// ─── 世界加载装配（Phase 4） ──────────────────────
// 仅做装配编排，不含具体业务：按依赖顺序调用各模块的 init / restore

import { system, world } from "@minecraft/server";

import { registerAllEvents } from "../events/index";
import { startTagBehaviors } from "../features/state/behavior";
// initPositionTracker 已内聚至 lifecycle/PositionComponent，此处不再单独初始化（保留导入兼容旧调用）
import { initTridentTracker } from "../features/trident/tridentTracker";
import { initFishingHookTracker, initLootTracker } from "../features/flow";
import { initRaidMode } from "../features/flow/raidMode";
import { startBrainEngine } from "../legacy/ai/BotBrain";
import { startAiEngine, startSharedMemorySweeper } from "../features/ai/brainEngine";
import { registerUiDrivers } from "./uiDrivers";
import { runMigrations } from "./migration";
import { botLifecycle, configStore } from "./context";
import { initGameTestContext } from "../features/manage/gametestContext";
// initAutoOnline 已内聚至 lifecycle/AutoOnlineComponent，worldLoad 不再单独调用

let worldLoadReady = false;

export async function handleWorldLoad(): Promise<void> {
  if (worldLoadReady) {
    console.info(`[MockPlayer] worldLoad 已初始化，跳过重复启动`);
    return;
  }
  worldLoadReady = true;

  try {
    configStore.refresh();
  } catch (e: any) {
    console.warn(`[MockPlayer] config 刷新失败: ${e?.message ?? e}`);
  }
  let gameTestReady = false;
  try {
    gameTestReady = await initGameTestContext();
    console.info(`[MockPlayer] GameTest ${gameTestReady ? "就绪" : "未就绪，回退"}`);
  } catch (e: any) {
    console.warn(`[MockPlayer] GameTest 初始化失败: ${e?.message ?? e}`);
  }

  console.info(`[MockPlayer] 注册事件（GameTest ${gameTestReady ? "就绪" : "未就绪"}后）`);
  try {
    registerAllEvents();
  } catch (e: any) {
    console.warn(`[MockPlayer] 事件注册失败: ${e?.message ?? e}`);
  }
  try {
    registerUiDrivers();
  } catch (e: any) {
    console.warn(`[MockPlayer] UI 驱动注册失败: ${e?.message ?? e}`);
  }

  let restored: any[] = [];
  try {
    // ── 组件化生命周期：恢复经编排器统一入口，触发 onWorldLoad 钩子与 LifecycleEvents.worldLoad ──
    restored = await botLifecycle.worldLoad();
    console.info(
      `[MockPlayer] 从持久化恢复 ${restored.length} 个模拟玩家记录（自动上线=${configStore.get().autoOnlineOnRestart}） 组件[${botLifecycle.listComponents().join(", ")}]`
    );
  } catch (e: any) {
    console.warn(`[MockPlayer] 恢复记录失败: ${e?.message ?? e}`);
  }
    // 辅助区块孤儿清理已内聚至 lifecycle/TickingAreaComponent.onWorldLoad

  try {
    runMigrations();
  } catch (e: any) {
    console.warn(`[MockPlayer] 迁移失败: ${e?.message ?? e}`);
  }
    // 自动上线已内聚至 lifecycle/AutoOnlineComponent.onWorldLoad

  console.info(`[MockPlayer] 启动引擎（lifecycle 已接管 Session/Death/Inventory/Position，剩余引擎按需启动）`);
  for (const fn of [
    startTagBehaviors,
    initTridentTracker,
    initFishingHookTracker,
    initLootTracker,
    // initPositionTracker 已由 lifecycle/PositionComponent 内聚，此处不再重复订阅
    initRaidMode,
    startBrainEngine,
    startAiEngine,
    startSharedMemorySweeper,
  ] as const) {
    try {
      (fn as any)();
    } catch (e: any) {
      console.warn(`[MockPlayer] 引擎 ${fn.name} 启动失败: ${e?.message ?? e}`);
    }
  }
}

export function initWorldLoad(): void {
  world.afterEvents.worldLoad.subscribe(() => {
    void handleWorldLoad().catch((e: any) => console.warn(`[MockPlayer] worldLoad 异常: ${e?.message ?? e}`));
  });
}
