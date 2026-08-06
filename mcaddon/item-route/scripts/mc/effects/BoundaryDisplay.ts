// ─── 边界显示：12 棱线框，粒子网格绘制（不破坏方块/无需还原） ──
// 两种形态（v1 BoundaryDisplay 口径）：
//   · **临时边界**（boundary-glow 事件）：建仓/调整区域后的视觉反馈，TEMP_DURATION_TICKS 自动停。
//   · **持久边界**（showBoundary 设置）：持续显示，仅当 guard() 为真（附近玩家持信物）才绘制；
//     随设置开关启停。同仓库两种形态互斥（start 一律先 stop，防旧 timeout 停新边界）。
// 关键点（审查）：
//   · 纯粒子方案（用户定案）：不放置/还原临时方块，无副作用，区块无需写。
//   · 无玩家在场不播放（省资源，玩家回来自动恢复）；持久边界额外要求**附近玩家持信物**
//     （v1 BoundaryDisplay：持久边界 requireHoe=true，临时边界不需要）。
//   · 采样点由 core 纯几何 edgePoints 生成（去重后撒点），本文件只做 mc 侧驱动。
//   · 粒子用原版 endrod（v1 同款：纯原版粒子，无自定义资源依赖）。
import { world, system, type Dimension } from "@minecraft/server";
import type { EventBus, VisualEffectEvent } from "../../core/events/DomainEvents";
import { edgePoints, STEP } from "../../core/model/BoundaryGeometry";

export { edgePoints, STEP };
export const REFRESH_INTERVAL = 40; // 粒子刷新间隔 tick（2 秒）
export const TEMP_DURATION_TICKS = 200; // 临时边界持续时间（10 秒）
export const PROXIMITY_MARGIN = 8; // 持久边界玩家接近判定外扩格数（v1 同款）
/** 边界棱线粒子（v1 用 endrod 白色线框，纯原版粒子） */
export const BOUNDARY_PARTICLE = "minecraft:endrod";

/** 边界显示选项 */
export interface BoundaryOptions {
  dimensionId: string;
  area: { corner1: { x: number; y: number; z: number }; corner2: { x: number; y: number; z: number } };
  durationTicks?: number;
  particle?: string;
}

interface ActiveBoundary {
  handle: number;
  /** 临时边界的自动停止句柄（持久边界无） */
  timeout?: number;
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
 * 单轮绘制：对每个采样点撒粒子（逐坐标 getBlock 跳过未加载区块）。
 * 维度/区块异常 → 跳过本轮（不终止 interval，玩家回来自动恢复）。
 */
function drawOnce(dim: Dimension, pts: Array<{ x: number; y: number; z: number }>, particle: string): void {
  for (const p of pts) {
    try {
      dim.getBlock({ x: p.x, y: p.y, z: p.z });
    } catch {
      continue; // 未加载区块：该坐标跳过
    }
    dim.spawnParticle(particle, { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
  }
}

/** 停止某仓库边界（临时/持久同 key，一并清 interval + 超时句柄） */
export function stopBoundary(warehouseId: string): void {
  const active = activeBoundaries.get(warehouseId);
  if (active === undefined) return;
  system.clearRun(active.handle);
  if (active.timeout !== undefined) system.clearRun(active.timeout);
  activeBoundaries.delete(warehouseId);
}

/**
 * 启动临时边界：在 12 条棱线上周期性（REFRESH_INTERVAL）循环撒粒子，
 * TEMP_DURATION_TICKS 后自动停止。同仓库先停旧的（含持久边界）。
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
    if (dim.getPlayers().length === 0) return; // 无玩家在场不播放
    drawOnce(dim, pts, particle);
  }, REFRESH_INTERVAL);

  activeBoundaries.set(warehouseId, {
    handle,
    timeout: system.runTimeout(() => stopBoundary(warehouseId), duration),
  });
}

/**
 * 启动持久边界（showBoundary 设置）：周期性撒粒子，但**仅当 guard() 为真**
 * （附近玩家持信物）才绘制；不自动停止，由 setPersistentBoundary(false)/stopBoundary 关闭。
 * 同仓库先停旧的（含临时边界）。
 */
export function startPersistentBoundary(warehouseId: string, options: BoundaryOptions, guard: () => boolean): void {
  stopBoundary(warehouseId);
  const dim = world.getDimension(options.dimensionId);
  if (dim === undefined) return;
  const particle = options.particle ?? BOUNDARY_PARTICLE;
  const pts = uniquePoints(options.area);

  const handle = system.runInterval(() => {
    if (!guard()) return; // 附近无持信物玩家 → 不绘制（v1 持久边界口径）
    drawOnce(dim, pts, particle);
  }, REFRESH_INTERVAL);

  activeBoundaries.set(warehouseId, { handle });
}

/** 按 showBoundary 开关启停持久边界（enabled=true 启动，false 停止） */
export function setPersistentBoundary(
  warehouseId: string,
  options: BoundaryOptions,
  enabled: boolean,
  guard: () => boolean
): void {
  if (enabled) startPersistentBoundary(warehouseId, options, guard);
  else stopBoundary(warehouseId);
}

/** 订阅领域事件 boundary-glow：显示临时粒子边界（建仓/调整区域后） */
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
