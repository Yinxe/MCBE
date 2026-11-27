// ─── 边界可见性判定（纯函数，零 MC 依赖，可单测） ─────────────
// 从 BoundaryDisplay.ts 抽出：那个文件顶层 import @minecraft/server，
// node --test 加载不了；而「哪些仓该显示」「松手后何时停」恰恰最该被测。
//
// 修复的两个 BUG：
//   BUG2-a：旧实现是「每仓一个 interval + 逐仓 showBoundary 开关 + 逐仓 guard」，
//           只能看到手动开的那一个仓。现在按**玩家**遍历，一个玩家附近的**所有**
//           开了 showBoundary 的仓都显示。
//   BUG2-b：旧实现松手后没有「尽快停止」，只能等 2.5 秒粒子自然消亡。
//           现在有显式宽限期状态机：松手后 GRACE_TICKS 内重新拿起则继续，
//           否则立刻停止绘制（盒子自身淡出）。
import type { Warehouse } from "./Warehouse";
import { isPlayerNearby } from "./Area";

/** 附近判定外扩格数 */
export const PROXIMITY_MARGIN = 8;

/** 松手宽限（tick）：3 秒内重新拿起信物则继续显示，否则停止绘制 */
export const GRACE_TICKS = 60;

/** 持信物玩家位置（维度 + XZ） */
export interface TokenHolder {
  dimension: string;
  x: number;
  z: number;
}

/**
 * 该仓库是否应画在**这个持信物玩家**附近。
 *
 * 三个条件缺一不可：
 * 1. 仓库开了 showBoundary；
 * 2. 同维度；
 * 3. 玩家在该仓附近（外扩 PROXIMITY_MARGIN）。
 *
 * @param warehouse - 仓库
 * @param holder    - 持信物玩家位置
 */
export function shouldDrawBoundary(warehouse: Warehouse, holder: TokenHolder): boolean {
  if (!warehouse.settings.showBoundary) return false;
  if (warehouse.area.dimension !== holder.dimension) return false;
  return isPlayerNearby(warehouse.area, [holder], PROXIMITY_MARGIN);
}

/**
 * 收集某玩家附近所有应显示的仓库。
 *
 * 按**玩家**遍历（而非按仓库遍历 + 逐仓 guard）是 BUG2-a 的修复点：
 * 一个玩家站在三个仓中间时，三个仓的框都该出现。
 *
 * @param warehouses - 已加载仓库
 * @param holder     - 持信物玩家位置
 * @returns 应显示的仓库（可能为空数组）
 */
export function visibleWarehousesFor(warehouses: Warehouse[], holder: TokenHolder): Warehouse[] {
  return warehouses.filter((w) => shouldDrawBoundary(w, holder));
}

/** 宽限期状态机状态 */
export interface GraceState {
  /** 上一帧是否有玩家持信物 */
  lastHolding: boolean;
  /** 宽限期末刻（tick）；仅 lastHolding=false 时生效 */
  graceUntil: number;
}

/** 状态机输入 */
export interface GraceInput {
  /** 本帧是否有玩家持信物 */
  holding: boolean;
  /** 当前 tick */
  now: number;
}

/**
 * 推进宽限期状态机，并回答「本帧是否应该绘制」。
 *
 * 语义：
 * - 持信物 → 立即绘制，并把宽限期推到 now + GRACE_TICKS。
 * - 刚松手（上一帧还在持）→ **本帧仍绘制**（让盒子自然淡出而不是硬切），
 *   同时开始计时。
 * - 松手后仍在宽限期内 → 继续绘制（玩家可能只是切换物品栏，很快切回来）。
 * - 宽限期满 → 停止绘制。
 *
 * 返回新状态，调用方自行保存（纯函数，不持模块级可变状态）。
 */
export function advanceGrace(state: GraceState, input: GraceInput): { state: GraceState; shouldDraw: boolean } {
  if (input.holding) {
    return { state: { lastHolding: true, graceUntil: input.now + GRACE_TICKS }, shouldDraw: true };
  }
  if (state.lastHolding) {
    // 刚松手：本帧仍画一次，并开始宽限
    return { state: { lastHolding: false, graceUntil: input.now + GRACE_TICKS }, shouldDraw: true };
  }
  // 已在宽限期：未到期就继续画
  return { state, shouldDraw: input.now < state.graceUntil };
}
