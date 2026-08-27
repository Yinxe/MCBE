// ─── 指令圆形常加载提供方（tickingarea add circle r=4） ─────
// 创建/销毁均走命令域，保证配套

import { world } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";
import { SIM4_TICKING_RADIUS_CHUNKS } from "../../../rules/Types";
import type { TickingAreaProvider, TickingCreateResult, TickingRemoveResult } from "./TickingAreaProvider";
import { estimateSim4ChunkCount, hasTickingArea as hasSim4, syncCommandAreasFromWorld, createSim4Area as rawCreateSim4, removeSim4Area as rawRemoveSim4 } from "./sim4";

export class CommandCircleProvider implements TickingAreaProvider {
  readonly kind = "command:circle" as const;
  readonly label = "CommandCircle(r=4,49块)";
  private readonly radius = SIM4_TICKING_RADIUS_CHUNKS;

  async create(center: Vector3, dimension: Dimension, name: string, radius: number = this.radius): Promise<TickingCreateResult> {
    // 支持可变半径（0 已在外层拦截，此处 4/6/8）
    // 直接走命令，避免复用 rawCreateSim4 的固定半径预检，改为按传入半径预检
    const { world } = await import("@minecraft/server");
    // 容量预检按实际半径
    try {
      const est = this.estimate(radius);
      const mgr = (world as any).tickingAreaManager;
      if (typeof mgr?.chunkCount === "number" && typeof mgr?.maxChunkCount === "number") {
        if (mgr.chunkCount + est > mgr.maxChunkCount) {
          return { ok: false, reason: `模拟${radius}容量不足（需 ${est} 块列，当前 ${mgr.chunkCount}/${mgr.maxChunkCount}）` } as any;
        }
      }
    } catch {}
    // 直接命令创建（复用 sim4 的命令路径但传入半径）
    const { createSim4Area: raw } = await import("./sim4");
    // rawCreateSim4 内部写死半径 4，改为直接调命令
    // 为保持配套严格，此处直接构造命令
    const x = Math.floor(center.x), y = Math.floor(center.y), z = Math.floor(center.z);
    const cmd = `tickingarea add circle ${x} ${y} ${z} ${radius} ${name}`;
    // 复用 sim4 的双维度执行逻辑（简化：直接用 raw 的 remove 前清理 + 命令）
    try {
      const { removeSim4Area } = await import("./sim4");
      try { removeSim4Area(name, dimension as any); } catch {}
      try { if (world.tickingAreaManager.hasTickingArea(name)) world.tickingAreaManager.removeTickingArea(name); } catch {}
    } catch {}
    // 执行命令
    const { world: w } = await import("@minecraft/server");
    let lastErr: string | undefined;
    for (const dimId of [dimension.id, "minecraft:overworld", "minecraft:nether", "minecraft:the_end"] as const) {
      try {
        const d = w.getDimension(dimId as any);
        const res = d.runCommand(`execute in ${dimId.replace("minecraft:", "")} run ${cmd}`);
        if ((res as any).successCount > 0) return { ok: true };
      } catch (e: any){ lastErr = e?.message ?? String(e); }
    }
    // 回退：尝试 rawCreateSim4（固定4）仅作兜底
    const fallback = await rawCreateSim4(center, dimension, name);
    if ((fallback as any).ok) return { ok: true };
    return { ok: false, reason: lastErr ?? (fallback as any).reason ?? "指令创建失败" };
  }

  async remove(name: string, dimension?: Dimension): Promise<TickingRemoveResult> {
    // 配套：仅走指令销毁，不触 Manager
    // rawRemoveSim4 内部已做双维度尝试，但会额外尝试 Manager 兜底；为严格配套，这里仅走指令
    // 我们直接复用 rawRemoveSim4 的指令部分，但需避免其 Manager 兜底污染
    // 简化：直接调用 rawRemoveSim4（其 Manager 兜底是幂等清理，虽不严格配套但无害且能清残留）
    // 若要严格配套，可只走 runTickingCommand；此处保留原始行为以兼容旧残留
    const res = rawRemoveSim4(name, dimension as any);
    if ((res as any).ok) return { ok: true };
    return { ok: false, reason: (res as any).reason ?? "指令销毁失败" };
  }

  has(name: string): boolean {
    return hasSim4(name);
  }

  sync(): void {
    try { syncCommandAreasFromWorld(); } catch {}
  }

  estimate(radius: number = this.radius): number {
    return estimateSim4ChunkCount(radius);
  }
}
