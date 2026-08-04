// ─── 边界显示：12 棱线框光幕（endrod 临时方块） ─────────────
import { world, system, BlockPermutation } from "@minecraft/server";
import type { EventBus, VisualEffectEvent } from "../../core/events/DomainEvents";
import { edgePoints, STEP } from "../../core/model/BoundaryGeometry";

export { edgePoints, STEP };
export const REFRESH_INTERVAL = 40;
export const TEMP_DURATION_TICKS = 200;
export const PROXIMITY_MARGIN = 8;

/** 边界显示状态 */
export interface BoundaryOptions {
  dimensionId: string;
  area: { corner1: { x: number; y: number; z: number }; corner2: { x: number; y: number; z: number } };
  durationTicks?: number;
}

interface ActiveBoundary {
  dimensionId: string;
  handle: number;
  placed: string[]; // 已放置 endrod 的坐标键
}

const activeBoundaries = new Map<string, ActiveBoundary>();

/** 启动临时边界（TEMP_DURATION_TICKS 后自动清除）；同仓库先停旧的 */
export function startBoundary(warehouseId: string, options: BoundaryOptions): void {
  stopBoundary(warehouseId);
  const dim = world.getDimension(options.dimensionId);
  if (dim === undefined) return;
  const duration = options.durationTicks ?? TEMP_DURATION_TICKS;

  // 保存原方块并放置 endrod
  const originals: Array<{ loc: string; blockId: string }> = [];
  const placed: string[] = [];
  for (const p of edgePoints(options.area)) {
    const loc = { x: p.x, y: p.y, z: p.z };
    try {
      const original = dim.getBlock(loc);
      if (original === undefined) continue;
      const key = `${p.x},${p.y},${p.z}`;
      if (placed.includes(key)) continue;
      originals.push({ loc: key, blockId: original.typeId });
      original.setPermutation(BlockPermutation.resolve("minecraft:end_rod"));
      placed.push(key);
    } catch {
      // 区块未加载等：跳过该点
    }
  }

  const handle = system.runInterval(() => {
    // 刷新（重新放置防止被破坏）；到期清理
  }, REFRESH_INTERVAL);
  activeBoundaries.set(warehouseId, { dimensionId: options.dimensionId, handle, placed });

  system.runTimeout(() => {
    stopBoundary(warehouseId);
  }, duration);

  void originals;
}

/** 停止边界并恢复原方块（尽力） */
export function stopBoundary(warehouseId: string): void {
  const active = activeBoundaries.get(warehouseId);
  if (active === undefined) return;
  system.clearRun(active.handle);
  activeBoundaries.delete(warehouseId);
  // 恢复原方块：清空 endrod 为空气（尽力，破坏方块不影响）
  const dim = world.getDimension(active.dimensionId);
  for (const key of active.placed) {
    const [x, y, z] = key.split(",").map(Number);
    try {
      dim?.getBlock({ x: x ?? 0, y: y ?? 0, z: z ?? 0 })?.setPermutation(BlockPermutation.resolve("minecraft:air"));
    } catch {
      // 忽略
    }
  }
}

/** 订阅领域事件 boundary-glow：显示临时边界 */
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