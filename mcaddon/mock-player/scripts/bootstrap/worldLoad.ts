// ─── 世界加载装配（Phase 4） ──────────────────────
// 仅做装配编排，不含具体业务：按依赖顺序调用各模块的 init / restore

import { system, world } from "@minecraft/server";

import { registerAllEvents } from "../events/index";
import { startTagBehaviors } from "../features/state/behavior";
import { initPositionTracker } from "../features/basic/PositionTracker";
import { initTridentTracker } from "../features/trident/tridentTracker";
import { initFishingHookTracker, initLootTracker } from "../features/flow";
import { initRaidMode } from "../features/flow/raidMode";
import { startBrainEngine } from "../legacy/ai/BotBrain";
import { startAiEngine, startSharedMemorySweeper } from "../features/ai/brainEngine";
import { registerUiDrivers } from "./uiDrivers";
import { runMigrations } from "./migration";
import { botRegistry, configStore } from "./context";
import { initGameTestContext } from "../features/manage/gametestContext";
import { initAutoOnline } from "../features/manage/autoOnline";

let worldLoadReady = false;

export function handleWorldLoad(): void {
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
  try {
    initGameTestContext();
  } catch (e: any) {
    console.warn(`[MockPlayer] GameTest 初始化失败: ${e?.message ?? e}`);
  }

  console.info(`[MockPlayer] 注册事件`);
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
    restored = botRegistry.restoreAll({ autoOnlineOnRestart: configStore.get().autoOnlineOnRestart });
    console.info(
      `[MockPlayer] 从持久化恢复 ${restored.length} 个模拟玩家记录（自动上线=${configStore.get().autoOnlineOnRestart}）`
    );
  } catch (e: any) {
    console.warn(`[MockPlayer] 恢复记录失败: ${e?.message ?? e}`);
  }

  try {
    runMigrations();
  } catch (e: any) {
    console.warn(`[MockPlayer] 迁移失败: ${e?.message ?? e}`);
  }

  system.run(() => {
    void initAutoOnline().catch((e: any) => console.warn(`[MockPlayer] 自动上线异常: ${e?.message ?? e}`));
  });

  console.info(`[MockPlayer] 启动引擎`);
  for (const fn of [
    startTagBehaviors,
    initTridentTracker,
    initFishingHookTracker,
    initLootTracker,
    initPositionTracker,
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
  world.afterEvents.worldLoad.subscribe(() => handleWorldLoad());
}
