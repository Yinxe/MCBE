// ─── 常加载提供方实现（配套） ───────────────────────
// 指令圆形 与 Manager单块 两种提供方，创建/销毁严格配套

import { world } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";
import { SIM4_TICKING_RADIUS_CHUNKS } from "../../../rules/Types";
import { estimateSim4ChunkCount, hasTickingArea as hasSim4, syncCommandAreasFromWorld, createSim4Area as rawCreateSim4, removeSim4Area as rawRemoveSim4 } from "./sim4";
import { createSingleChunkArea as rawCreateSingle, removeSingleChunkArea as rawRemoveSingle } from "./singleChunk";
import type { TickingAreaProvider, TickingCreateResult, TickingRemoveResult } from "./TickingAreaProvider";

/** 指令圆形提供方（tickingarea add circle r=4/6/8） */
export class CommandCircleProvider implements TickingAreaProvider {
  readonly kind = "command:circle" as const;
  readonly label = "CommandCircle";
  private readonly radius = SIM4_TICKING_RADIUS_CHUNKS;

  async create(center: Vector3, dimension: Dimension, name: string, radius: number = this.radius): Promise<TickingCreateResult> {
    const { world } = await import("@minecraft/server");
    try {
      const est = this.estimate(radius);
      const mgr = (world as any).tickingAreaManager;
      if (typeof mgr?.chunkCount === "number" && typeof mgr?.maxChunkCount === "number") {
        if (mgr.chunkCount + est > mgr.maxChunkCount) {
          return { ok: false, reason: `模拟${radius}容量不足（需 ${est} 块列，当前 ${mgr.chunkCount}/${mgr.maxChunkCount}）` } as any;
        }
      }
    } catch {}
    try { const { removeSim4Area } = await import("./sim4"); try { removeSim4Area(name, dimension as any); } catch {} try { if (world.tickingAreaManager.hasTickingArea(name)) world.tickingAreaManager.removeTickingArea(name); } catch {} } catch {}
    const x = Math.floor(center.x), y = Math.floor(center.y), z = Math.floor(center.z);
    const cmd = `tickingarea add circle ${x} ${y} ${z} ${radius} ${name}`;
    let lastErr: string | undefined;
    for (const dimId of [dimension.id, "minecraft:overworld", "minecraft:nether", "minecraft:the_end"] as const) {
      try {
        const d = world.getDimension(dimId as any);
        const res = d.runCommand(`execute in ${dimId.replace("minecraft:", "")} run ${cmd}`);
        if ((res as any).successCount > 0) return { ok: true };
      } catch (e: any) { lastErr = e?.message ?? String(e); }
    }
    const fallback = await rawCreateSim4(center, dimension, name);
    if ((fallback as any).ok) return { ok: true };
    return { ok: false, reason: lastErr ?? (fallback as any).reason ?? "指令创建失败" };
  }

  async remove(name: string, dimension?: Dimension): Promise<TickingRemoveResult> {
    const res = rawRemoveSim4(name, dimension as any);
    if ((res as any).ok) return { ok: true };
    return { ok: false, reason: (res as any).reason ?? "指令销毁失败" };
  }

  has(name: string): boolean { return hasSim4(name); }
  sync(): void { try { syncCommandAreasFromWorld(); } catch {} }
  estimate(radius: number = this.radius): number { return estimateSim4ChunkCount(radius); }
}

/** Manager 单块提供方（tickingAreaManager 单 chunk） */
export class ManagerSingleChunkProvider implements TickingAreaProvider {
  readonly kind = "manager:single" as const;
  readonly label = "ManagerSingleChunk";

  async create(center: Vector3, dimension: Dimension, name: string): Promise<TickingCreateResult> {
    const res = await rawCreateSingle(center, dimension, name);
    if ((res as any).ok) return { ok: true };
    return { ok: false, reason: (res as any).reason ?? "Manager 创建失败" };
  }

  async remove(name: string, _dimension?: Dimension): Promise<TickingRemoveResult> {
    const res = rawRemoveSingle(name);
    if ((res as any).ok) return { ok: true };
    return { ok: false, reason: (res as any).reason ?? "Manager 销毁失败" };
  }

  has(name: string): boolean {
    try { return world.tickingAreaManager.hasTickingArea(name); } catch { return false; }
  }

  sync(): void {}
  estimate(): number { return 1; }
}
