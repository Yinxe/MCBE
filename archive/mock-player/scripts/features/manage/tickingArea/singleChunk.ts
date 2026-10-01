// ─── 单区块常加载（Manager 矩形单 chunk） ───────────
// 供下线前占位：Manager 隔离域，支持 255 并发

import { world } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";

export async function createSingleChunkArea(center: Vector3, dimension: Dimension, name: string) {
  if (!name) return { ok: false, reason: "常加载区域名不能为空" } as const;
  try {
    if (world.tickingAreaManager.hasTickingArea(name)) world.tickingAreaManager.removeTickingArea(name);
  } catch {}
  const chunkX = Math.floor(center.x / 16),
    chunkZ = Math.floor(center.z / 16);
  const from = { x: chunkX * 16, y: 0, z: chunkZ * 16 };
  const to = { x: chunkX * 16 + 15, y: 0, z: chunkZ * 16 + 15 };
  const opts = { dimension, from, to } as const;
  try {
    if (!world.tickingAreaManager.hasCapacity(opts as any))
      return {
        ok: false,
        reason: `单区块常加载容量不足（${world.tickingAreaManager.chunkCount}/${world.tickingAreaManager.maxChunkCount}）`,
      } as const;
  } catch (e: any) {
    return { ok: false, reason: `hasCapacity 检查失败: ${e?.message ?? e}` } as const;
  }
  try {
    await world.tickingAreaManager.createTickingArea(name, opts as any);
    return { ok: true } as const;
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) } as const;
  }
}

export function removeSingleChunkArea(name: string) {
  try {
    if (world.tickingAreaManager.hasTickingArea(name)) {
      world.tickingAreaManager.removeTickingArea(name);
      return { ok: true } as const;
    }
    // 未找到 = 已被清理/从未创建（如容量不足时申请失败的正常终态），按幂等成功处理
    return { ok: true } as const;
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) } as const;
  }
}
