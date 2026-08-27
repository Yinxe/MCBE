// ─── Manager 单区块提供方（world.tickingAreaManager） ─────
// 创建/销毁均走 Manager，保证配套（与指令域隔离）

import { world } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";
import type { TickingAreaProvider, TickingCreateResult, TickingRemoveResult } from "./TickingAreaProvider";
import { createSingleChunkArea as rawCreateSingle, removeSingleChunkArea as rawRemoveSingle } from "./singleChunk";

export class ManagerSingleChunkProvider implements TickingAreaProvider {
  readonly kind = "manager:single" as const;
  readonly label = "ManagerSingleChunk(1块列)";

  async create(center: Vector3, dimension: Dimension, name: string, _radius?: number): Promise<TickingCreateResult> {
    const res = await rawCreateSingle(center, dimension, name);
    if ((res as any).ok) return { ok: true };
    return { ok: false, reason: (res as any).reason ?? "Manager 创建失败" };
  }

  async remove(name: string, _dimension?: Dimension, _radius?: number): Promise<TickingRemoveResult> {
    const res = rawRemoveSingle(name);
    if ((res as any).ok) return { ok: true };
    return { ok: false, reason: (res as any).reason ?? "Manager 销毁失败" };
  }

  has(name: string): boolean {
    try { return world.tickingAreaManager.hasTickingArea(name); } catch { return false; }
  }

  sync(): void {
    // Manager 无需额外同步，has() 直接查世界
  }

  estimate(): number {
    return 1;
  }
}
