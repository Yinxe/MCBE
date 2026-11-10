// ─── 边界显示：12 棱线框，粒子网格绘制（不破坏方块/无需还原） ──
// 两种形态（v1 BoundaryDisplay 口径）：
//   · **临时边界**（boundary-glow 事件）：建仓/调整区域后的视觉反馈，TEMP_DURATION_TICKS 自动停。
//   · **持久边界**（showBoundary 设置）：持续显示，仅当 guard() 为真（附近玩家持信物）才绘制；
//     随设置开关启停。
// ⚠️ 临时/持久**各自独立跟踪**（item 9.7 修复）：临时边界（建仓/调区 glow）不得顶掉持久边界——
//    否则 showBoundary 开启的仓库经一次建仓/调区后，持久边界被临时边界 stop，临时结束即消失。
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

/** 临时边界（boundary-glow）与持久边界（showBoundary）**独立跟踪**，互不覆盖 */
const tempBoundaries = new Map<string, ActiveBoundary>();
const persistentBoundaries = new Map<string, ActiveBoundary>();

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
 * 粒子撒在**方块边界**（原始整数坐标 = 方块网格棱线），而非方块正中心（+0.5）——
 * v1 口径：边界光幕从方块边界开始显示、框住整个仓库区域（内部都是仓库区域）。
 * 维度/区块异常 → 跳过本轮（不终止 interval，玩家回来自动恢复）。
 */
function drawOnce(dim: Dimension, pts: Array<{ x: number; y: number; z: number }>, particle: string): void {
  for (const p of pts) {
    try {
      dim.getBlock({ x: p.x, y: p.y, z: p.z });
    } catch {
      continue; // 未加载区块：该坐标跳过
    }
    dim.spawnParticle(particle, { x: p.x, y: p.y, z: p.z });
  }
}

/** 停止某仓库的临时边界（不影响持久边界） */
function stopTemp(warehouseId: string): void {
  const active = tempBoundaries.get(warehouseId);
  if (active === undefined) return;
  system.clearRun(active.handle);
  if (active.timeout !== undefined) system.clearRun(active.timeout);
  tempBoundaries.delete(warehouseId);
}

/** 停止某仓库的持久边界（不影响临时边界） */
function stopPersistent(warehouseId: string): void {
  const active = persistentBoundaries.get(warehouseId);
  if (active === undefined) return;
  system.clearRun(active.handle);
  persistentBoundaries.delete(warehouseId);
}

/** 停止某仓库全部边界（临时 + 持久；删除仓库/showBoundary 关闭用） */
export function stopBoundary(warehouseId: string): void {
  stopTemp(warehouseId);
  stopPersistent(warehouseId);
}

/**
 * 启动临时边界：在 12 条棱线上周期性（REFRESH_INTERVAL）循环撒粒子，
 * TEMP_DURATION_TICKS 后自动停止。只清同 key 旧临时边界（**不动持久边界**，item 9.7）。
 * 维度内无玩家在场时不播放（省资源，玩家回来自动恢复）。
 */
export function startBoundary(warehouseId: string, options: BoundaryOptions): void {
  stopTemp(warehouseId);
  const dim = world.getDimension(options.dimensionId);
  if (dim === undefined) return;
  const duration = options.durationTicks ?? TEMP_DURATION_TICKS;
  const particle = options.particle ?? BOUNDARY_PARTICLE;
  const pts = uniquePoints(options.area);

  const handle = system.runInterval(() => {
    if (dim.getPlayers().length === 0) return; // 无玩家在场不播放
    drawOnce(dim, pts, particle);
  }, REFRESH_INTERVAL);

  tempBoundaries.set(warehouseId, {
    handle,
    timeout: system.runTimeout(() => stopTemp(warehouseId), duration),
  });
}

/**
 * 启动持久边界（showBoundary 设置）：周期性撒粒子，但**仅当 guard() 为真**
 * （附近玩家持信物）才绘制；不自动停止，由 setPersistentBoundary(false)/stopBoundary 关闭。
 * 只清同 key 旧持久边界（**不动临时边界**）。
 */
export function startPersistentBoundary(warehouseId: string, options: BoundaryOptions, guard: () => boolean): void {
  stopPersistent(warehouseId);
  const dim = world.getDimension(options.dimensionId);
  if (dim === undefined) return;
  const particle = options.particle ?? BOUNDARY_PARTICLE;
  const pts = uniquePoints(options.area);

  const handle = system.runInterval(() => {
    if (!guard()) return; // 附近无持信物玩家 → 不绘制（v1 持久边界口径）
    drawOnce(dim, pts, particle);
  }, REFRESH_INTERVAL);

  persistentBoundaries.set(warehouseId, { handle });
}

/** 按 showBoundary 开关启停持久边界（enabled=true 启动，false 仅停持久，临时 glow 不受影响） */
export function setPersistentBoundary(
  warehouseId: string,
  options: BoundaryOptions,
  enabled: boolean,
  guard: () => boolean
): void {
  if (enabled) startPersistentBoundary(warehouseId, options, guard);
  else stopPersistent(warehouseId);
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
