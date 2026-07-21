// ─── GameTest 上下文管理 ──────────────────────────────
//
// 注册一个永续 GameTest，提供 test.spawnSimulatedPlayer 的区块常加载能力。
// 只被 spawnMode.ts 的 chunkload 模式使用。
//
// register 在模块级执行（early-execution 安全），
// 结构创建 + 命令启动在 worldLoad 后的 system.run 中。

import { world, system, StructureSaveMode } from "@minecraft/server";
import { register, Test } from "@minecraft/server-gametest";

export let globalTest: Test | null = null;

const CLASS = "mockplayer";
const NAME = "keepalive";
const STRUCTURE_ID = `${CLASS}:void`;

// 模块级注册（early-execution mode 可安全调用）
register(CLASS, NAME, (test: Test) => {
  globalTest = test;
  console.warn("[MockPlayer] GameTest 上下文就绪");
})
  .maxTicks(2_000_000_000)
  .structureName(STRUCTURE_ID);

export function initGameTestContext(): void {
  system.run(() => {
    try {
      // 创建空结构（如不存在）
      if (!world.structureManager.get(STRUCTURE_ID)) {
        world.structureManager.createEmpty(STRUCTURE_ID, { x: 1, y: 1, z: 1 }, StructureSaveMode.World);
      }

      // 在远离玩家的位置启动 GameTest
      const zOff = -15000000 + Math.floor(Math.random() * 1000) * 16;
      world.getDimension("minecraft:overworld")
        .runCommand(`execute positioned 15000000 256 ${zOff} run gametest run ${CLASS}:${NAME}`);

      // 保存当前游戏规则（GameTest 启动后会篡改它们）
      const savedTick = world.gameRules.randomTickSpeed;
      const savedDay = world.gameRules.doDayLightCycle;
      const savedMob = world.gameRules.doMobSpawning;

      // 用另一个 system.run 等 register 回调触发后恢复规则
      system.run(() => {
        if (globalTest) {
          world.gameRules.randomTickSpeed = savedTick;
          world.gameRules.doDayLightCycle = savedDay;
          world.gameRules.doMobSpawning = savedMob;
        }
      });
    } catch (e: any) {
      console.warn(`[MockPlayer] GameTest 初始化失败: ${e?.message ?? e}`);
    }
  });
}
