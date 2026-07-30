// ─── GameTest 上下文管理 ──────────────────────────────
//
// 注册一个永续 GameTest，提供 test.spawnSimulatedPlayer 的区块常加载能力。
// 只被 spawnMode.ts 的 chunkload 模式使用。
//
// 全部在 worldLoad 后的 system.run 中执行：
// 1. 保存当前游戏规则
// 2. 注册永续 GameTest（回调中立即恢复规则）
// 3. 启动测试
//
// ⚠️ 世界边界限制：GameTest 仅在世界边界内 ±~30,000,000 区块对齐位置注册。
//    此处硬编码 15000000 偏移（世界中心附近），若自定义世界边界过小，
//    GameTest 注册将失败。失败后 globalTest 保持 null，
//    spawnMode.ts 会回退到 normal 模式。

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

      // 3. 注册永续 GameTest（回调在测试启动时触发）
      register(CLASS, NAME, (test: Test) => {
        globalTest = test;
        // 立即恢复游戏规则
        world.gameRules.randomTickSpeed = savedTick;
        world.gameRules.doDayLightCycle = savedDay;
        world.gameRules.doMobSpawning = savedMob;
        console.warn("[MockPlayer] GameTest 上下文就绪");
      })
        .maxTicks(2_000_000_000)
        .structureName(STRUCTURE_ID);

      // 4. 启动测试
      const zOff = -15000000 + Math.floor(Math.random() * 1000) * 16;
      world.getDimension("minecraft:overworld")
        .runCommand(`execute positioned 15000000 256 ${zOff} run gametest run ${CLASS}:${NAME}`);
    } catch (e: any) {
      globalTest = null as any;
      console.warn(`[MockPlayer] GameTest 初始化失败: ${e?.message ?? e}`);
    }
  });
}
