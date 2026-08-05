// ─── 边界显示：12 棱线框，粒子网格绘制（不破坏方块/无需还原） ──
// 建仓/调整区域后的视觉反馈：沿仓库区域 12 条棱撒粒子（spawnParticle），
// 每 REFRESH_INTERVAL 刷新一轮，TEMP_DURATION_TICKS 后自动停。
// 关键点（审查）：
//   · 纯粒子方案（用户定案）：不放置/还原临时方块，无副作用，区块无需写。
//   · 无玩家在场不播放（省资源，玩家回来自动恢复）。
//   · 采样点由 core 纯几何 edgePoints 生成（去重后撒点），本文件只做 mc 侧驱动。
import { world, system } from "@minecraft/server";
import type { EventBus, VisualEffectEvent } from "../../core/events/DomainEvents";
import { edgePoints, STEP } from "../../core/model/BoundaryGeometry";

export { edgePoints, STEP };
export const REFRESH_INTERVAL = 40;   // 粒子刷新间隔 tick
export const TEMP_DURATION_TICKS = 200;
export const PROXIMITY_MARGIN = 8;
/** 边界棱线粒子（默认亮蓝 sparkle；可在不影响功能前提下替换） */
export const BOUNDARY_PARTICLE = "minecraft:blue_sparkle";

/** 边界显示选项 */
export interface BoundaryOptions {
  dimensionId: string;
  area: { corner1: { x: number; y: number; z: number }; corner2: { x: number; y: number; z: number } };
  durationTicks?: number;
  particle?: string;
}

interface ActiveBoundary {
  handle: number;
  timeout: number;
}

const activeBoundaries = new Map<string, ActiveBoundary>();

/** 去重棱线采样点（角点被 3 条棱共享，避免粒子重叠） */
function uniquePoints(area: BoundaryOptions["area"]): Array<{ x: number; y: number; z: number }> {
  const seen = new Set<string>();
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (const p of edgePoints(area, STEP)) {
    const key = `${p.x},${p.y},${p.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * 启动临时边界：在 12 条棱线上周期性（REFRESH_INTERVAL）循环撒粒子，
 * TEMP_DURATION_TICKS 后自动停止。同仓库先停旧的。
 * 维度内无玩家在场时不播放（省资源，玩家回来自动恢复）。
 */
export function startBoundary(warehouseId: string, options: BoundaryOptions): void {
  stopBoundary(warehouseId);
  const dim = world.getDimension(options.dimensionId);
  if (dim === undefined) return;
  const duration = options.durationTicks ?? TEMP_DURATION_TICKS;
  const particle = options.particle ?? BOUNDARY_PARTICLE;
  const pts = uniquePoints(options.area);

  const handle = system.runInterval(() => {
    try {
      if (dim.getPlayers().length === 0) return; // 无玩家在场不播放
      for (const p of pts) {
        dim.spawnParticle(particle, { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
      }
    } catch {
      // 区块/维度异常：跳过本轮
    }
  }, REFRESH_INTERVAL);

  activeBoundaries.set(warehouseId, {
    handle,
    timeout: system.runTimeout(() => stopBoundary(warehouseId), duration),
  });
}

/** 停止边界粒子（无需还原方块；同时清 interval + 超时句柄，防旧 timeout 提前停新边界） */
export function stopBoundary(warehouseId: string): void {
  const active = activeBoundaries.get(warehouseId);
  if (active === undefined) return;
  system.clearRun(active.handle);
  system.clearRun(active.timeout);
  activeBoundaries.delete(warehouseId);
}

/** 订阅领域事件 boundary-glow：显示临时粒子边界 */
export function registerBoundaryDisplay(
  bus: EventBus,
  resolveArea: (warehouseId: string) => { dimensionId: string; area: BoundaryOptions["area"] } | undefined
): void {
  bus.visualEffect.subscribe((e: VisualEffectEvent) => {
    try {
      if (e.kind !== "boundary-glow") return;
      const resolved = resolveArea(e.warehouseId);
      if (resolved === undefined) return;
      startBoundary(e.warehouseId, { dimensionId: resolved.dimensionId, area: resolved.area });
    } catch (err) {
      console.warn(`[item-route] 边界显示失败: ${err}`);
    }
  });
}