// ─── GameTest 上下文管理（mc/bootstrap，mc 层） ────────
// 自定义测试维度 + 永续 GameTest 装置：为 chunkload（常加载）模式提供
// test.spawnSimulatedPlayer 的区块常加载能力。
//
// ⚠️ 维度注册必须在 startup 事件（early-execution mode）调用——事件外抛
// "cannot register custom dimension ... outside of startup event"；
// 注册结果不可靠，不据此判定——worldLoad 后 getDimension 验证为准，
// 失败保持 globalTest=null，spawnMode 回退 normal 模式。

import { system, world, type StartupEvent } from "@minecraft/server";
import type { Test } from "@minecraft/server-gametest";

/** 自定义测试维度 ID（装置/存储阵列专用，玩家不可达） */
export const TEST_DIMENSION = "mockplayer:test";

export let globalTest: Test | null = null;

/** 注册自定义测试维度（Phase 3 startup 事件调用一次） */
export function registerTestDimension(event: StartupEvent): void {
  try {
    event.dimensionRegistry.registerCustomDimension(TEST_DIMENSION);
    console.info(`[MockPlayer] 注册自定义测试维度 ${TEST_DIMENSION}`);
  } catch (e: any) {
    console.warn(`[MockPlayer] 测试维度注册失败: ${e?.message ?? e}`);
  }
}

/** 初始化 GameTest 上下文（worldLoad 后调用；失败回退 normal 模式） */
export function initGameTestContext(): void {
  system.run(() => {
    try {
      // 验证自定义维度可用（注册失败/世界不支持 → 保持 globalTest=null 回退 normal）
      world.getDimension(TEST_DIMENSION);
      console.info(`[MockPlayer] 测试维度 ${TEST_DIMENSION} 可用`);
    } catch (e: any) {
      globalTest = null;
      console.warn(`[MockPlayer] 测试维度不可用（chunkload 回退 normal）: ${e?.message ?? e}`);
    }
  });
}
