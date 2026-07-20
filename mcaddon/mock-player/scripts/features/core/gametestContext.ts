// ─── GameTest 上下文管理 ──────────────────────────────
//
// 注册一个永续 GameTest，提供 test.spawnSimulatedPlayer 的区块常加载能力。
// 只被 spawnMode.ts 的 chunkload 模式使用。
//
// 全部初始化在 worldLoad 后的 system.run 中执行，避免 early-execution 限制。

import { world, system, StructureSaveMode } from "@minecraft/server";
import { register, Test } from "@minecraft/server-gametest";

export let globalTest: Test | null = null;

const CLASS = "mockplayer";
const NAME = "keepalive";
const STRUCTURE_ID = `${CLASS}:void`;

export function initGameTestContext(): void {
  system.run(() => {
    try {
      // 1. 创建空结构
      if (!world.structureManager.get(STRUCTURE_ID)) {
        world.structureManager.createEmpty(STRUCTURE_ID, { x: 1, y: 1, z: 1 }, StructureSaveMode.World);
      }

      // 2. 保存当前游戏规则（GameTest 启动时会篡改它们）
      const savedTick = world.gameRules.randomTickSpeed;
      const savedDay = world.gameRules.doDayLightCycle;
      const savedMob = world.gameRules.doMobSpawning;

      // 3. 注册 + 启动 GameTest
      register(CLASS, NAME, (test: Test) => {
        globalTest = test;
        world.gameRules.randomTickSpeed = savedTick;
        world.gameRules.doDayLightCycle = savedDay;
        world.gameRules.doMobSpawning = savedMob;
        console.warn("[MockPlayer] GameTest 上下文就绪");
      })
        .maxTicks(2_000_000_000)
        .structureName(STRUCTURE_ID);

      const zOff = -15000000 + Math.floor(Math.random() * 1000) * 16;
      world.getDimension("minecraft:overworld")
        .runCommand(`execute positioned 15000000 256 ${zOff} run gametest run ${CLASS}:${NAME}`);
    } catch (e: any) {
      console.warn(`[MockPlayer] GameTest 初始化失败: ${e?.message ?? e}`);
    }
  });
}
