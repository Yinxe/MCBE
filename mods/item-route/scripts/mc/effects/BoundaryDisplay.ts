// ─── 边界显示：立体盒子线框（一次 spawnParticle 画完） ──────────
// 两种形态：
//   · **临时边界**（boundary-glow 事件）：建仓/调整区域后的视觉反馈，TEMP_DURATION_TICKS 自动停。
//   · **持久边界**（showBoundary 设置）：持续显示，随设置开关启停。
// 两者**都要求** guard() 为真（附近玩家持信物）才绘制——非持信物玩家看不到任何边界。
// ⚠️ 临时/持久**各自独立跟踪**（item 9.7 修复）：临时边界（建仓/调区 glow）不得顶掉持久边界——
//    否则 showBoundary 开启的仓库经一次建仓/调区后，持久边界被临时边界 stop，临时结束即消失。
// 关键点（审查）：
//   · 纯粒子方案（用户定案）：不放置/还原临时方块，无副作用，区块无需写。
//   · 无玩家在场不播放（省资源，玩家回来自动恢复）；持久边界额外要求**附近玩家持信物**
//     （v1 BoundaryDisplay：持久边界 requireHoe=true，临时边界不需要）。
//   · 盒子由 BoxBoundary 一次 spawnParticle 画出（6 面 + 12 棱），
//     旧实现逐点撒 endrod（32×16×32 每轮约 500 次调用），现在只要 1 次。
import { world, system, type Dimension } from "@minecraft/server";
import type { EventBus, VisualEffectEvent } from "../../core/events/DomainEvents";
import { boxFromArea, type BoxShape } from "../../core/model/BoxShape";
import { COLOR_ACTIVE, COLOR_MAINTENANCE, drawBox } from "./BoxBoundary";
export const REFRESH_INTERVAL = 40; // 粒子刷新间隔 tick（2 秒）
export const TEMP_DURATION_TICKS = 200; // 临时边界持续时间（10 秒）
export const PROXIMITY_MARGIN = 8; // 持久边界玩家接近判定外扩格数（v1 同款）
/** 盒子存活秒数：比刷新间隔略长，让新旧盒子重叠衔接，避免每 2 秒闪一下 */
export const BOX_DURATION_SECONDS = 2.5;
/** 临时边界的盒子存活秒数 */
export const TEMP_BOX_DURATION_SECONDS = TEMP_DURATION_TICKS / 20;

/** 边界显示选项 */
export interface BoundaryOptions {
  dimensionId: string;
  area: { corner1: { x: number; y: number; z: number }; corner2: { x: number; y: number; z: number } };
  durationTicks?: number;
  /** 是否为维护中的仓库（决定线框颜色） */
  maintenance?: boolean;
}

interface ActiveBoundary {
  handle: number;
  /** 临时边界的自动停止句柄（持久边界无） */
  timeout?: number;
}

/** 临时边界（boundary-glow）与持久边界（showBoundary）**独立跟踪**，互不覆盖 */
const tempBoundaries = new Map<string, ActiveBoundary>();
const persistentBoundaries = new Map<string, ActiveBoundary>();

/** 区域 → 盒子形状（带缓存，避免每 2 秒重算） */
function shapeOf(area: BoundaryOptions["area"]): BoxShape {
  return boxFromArea({ dimension: "", corner1: area.corner1, corner2: area.corner2 });
}

/** 线框颜色：维护中用橙红，正常用白 */
function colorOf(maintenance: boolean | undefined) {
  return maintenance === true ? COLOR_MAINTENANCE : COLOR_ACTIVE;
}

/**
 * 单轮绘制：一次 spawnParticle 画完整盒子（区块未加载 → 静默跳过本轮）。
 * 盒子框住的是**方块本体**（中心 = (min+max+1)/2），见 BoxShape 注释。
 */
function drawOnce(dim: Dimension, shape: BoxShape, maintenance: boolean | undefined, seconds: number): void {
  const color = colorOf(maintenance);
  drawBox(dim, shape, { durationSeconds: seconds, faceColor: color, edgeColor: color });
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
export function startBoundary(warehouseId: string, options: BoundaryOptions, guard: () => boolean): void {
  stopTemp(warehouseId);
  const dim = world.getDimension(options.dimensionId);
  if (dim === undefined) return;
  const duration = options.durationTicks ?? TEMP_DURATION_TICKS;
  const shape = shapeOf(options.area);
  const seconds = Math.min(TEMP_BOX_DURATION_SECONDS, duration / 20);

  const handle = system.runInterval(() => {
    if (!guard()) return; // 附近无持信物玩家 → 不绘制（与持久边界同口径）
    drawOnce(dim, shape, options.maintenance, seconds);
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
  const shape = shapeOf(options.area);

  const handle = system.runInterval(() => {
    if (!guard()) return; // 附近无持信物玩家 → 不绘制
    drawOnce(dim, shape, options.maintenance, BOX_DURATION_SECONDS);
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
  resolveArea: (
    warehouseId: string
  ) => { dimensionId: string; area: BoundaryOptions["area"]; maintenance?: boolean } | undefined,
  guard: () => boolean
): void {
  bus.visualEffect.subscribe((e: VisualEffectEvent) => {
    try {
      if (e.kind !== "boundary-glow") return;
      const resolved = resolveArea(e.warehouseId);
      if (resolved === undefined) return;
      startBoundary(
        e.warehouseId,
        { dimensionId: resolved.dimensionId, area: resolved.area, maintenance: resolved.maintenance },
        guard
      );
    } catch (err) {
      console.warn(`[item-route] 边界显示失败: ${err}`);
    }
  });
}
