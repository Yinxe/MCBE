// ─── 生成组件（生命周期内聚） ─────────────────
// 职责：假人实体生成的唯一入口，封装 GameTest 生成、重名防护、传送、标签/姿态同步。
// 原逻辑在 features/manage/spawnMode.ts（254 行）与 features/manage/spawn.ts，
// 现通过此组件收敛于生命周期，由 BotLifecycle.doSpawn 委托调用，
// 外部不再直接 import spawnMode。

import type { SimulatedPlayer } from "@minecraft/server-gametest";
import type { BotRecord } from "../../rules/Types";
import type { LifecycleComponent } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";

export class SpawnComponent implements LifecycleComponent {
  readonly id = "spawn";
  readonly priority = 20;

  private ctx!: LifecycleContext;

  onRegister(ctx: LifecycleContext): void {
    this.ctx = ctx;
  }

  /**
   * 生成假人实体（统一走 test 中转，含三层重名防护）。
   * 供 BotLifecycle.create / online 调用，外部应通过 lifecycle 而非直接 spawnMode。
   */
  async spawn(
    record: BotRecord,
    location: { x: number; y: number; z: number },
    dimension: any,
    rotation: { x: number; y: number },
    lookTarget?: { x: number; y: number; z: number }
  ): Promise<SimulatedPlayer> {
    // 动态导入避免循环： SpawnComponent → spawnMode → bootstrap/context → lifecycle → SpawnComponent
    // 采用懒加载，待所有模块初始化完毕后解析。
    const { spawnBot } = await import("../../features/manage/spawnMode");
    return spawnBot(record, location as any, dimension as any, rotation as any, lookTarget as any);
  }
}
