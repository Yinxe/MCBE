// ─── 长途寻路分段（core 层纯函数） ─────────────────────
// 官方 API（navigateToLocation）无距离上限参数，引擎远距离导航易失败/卡死
// （已知问题）——长途寻路用分段接力：目标路径按单段最远距离切段，
// 逐段独立寻路（段内障碍由引擎绕行），段间无缝衔接。
// 本模块只做几何切段与段点 y 修正决策（纯函数，零 @minecraft 依赖），
// 世界查询执行在 mc 层（features/basic/move.groundifyWaypointY）。
//
// ⚠️ 段点 y（用户规格 2026-08-18 完全重构）：主路径**不再使用插值/吸附 y**——
//    mc 层统一取高位常量（WAYPOINT_HIGH_Y=330 > 世界建筑高度 320），官方
//    引擎按 xz 纯水平寻路。本模块的 decideWaypointY 地面化决策仅作**回退**
//    （高位目标不被引擎接受时）：
//   - y 处是空气 → 可用（引擎会寻路到其下方地面）
//   - y 处是非空气且非水（实心，=埋在方块里）→ 向上重算到第一个空气方块
//   - y 处是水（液体）→ 不调整（用户规格；配合段点 xz 判定兜底）
//   - 区块未加载 / 查询异常 → 降级保留插值 y

import type { Vec3 } from "../Types";

/** 长途寻路单段最远距离（格，水平）——
 *  ⚠️ 用户调参（2026-08-17）：16（短程寻路极限）→ 12。原 16 格单段"接近
 *  极限"：官方导航 API 单段路径越长越易失败（无路径可达/卡障碍/距离过远），
 *  缩短单段显著降低每段寻路复杂度与失败率（仍远高于玩家肉眼可感知的段粒度） */
export const LONG_NAV_SEGMENT_DISTANCE = 12;

/**
 * 长途寻路分段（纯几何）：起点 → 终点按水平距离等分切段，
 * 每段水平距离 ≤ maxSegment（缺省 12），最后一段自动收尾。
 * 垂直（y）随水平进度线性插值——避免段尾悬空/埋墙导致的寻路失败。
 *
 * @param start 起点（假人当前位置）
 * @param target 终点（长途目标）
 * @param maxSegment 单段最远水平距离（格；缺省 12）
 * @returns 分段路径点列表（含最后一段 = 终点；水平距离 ≤12 时单点直达）
 */
export function buildLongNavigateWaypoints(
  start: Vec3,
  target: Vec3,
  maxSegment: number = LONG_NAV_SEGMENT_DISTANCE,
): Vec3[] {
  const total = Math.hypot(target.x - start.x, target.z - start.z);
  if (total <= maxSegment) return [{ x: target.x, y: target.y, z: target.z }];
  const n = Math.ceil(total / maxSegment);
  const points: Vec3[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    points.push({
      x: start.x + (target.x - start.x) * t,
      y: start.y + (target.y - start.y) * t,
      z: start.z + (target.z - start.z) * t,
    });
  }
  return points;
}

// ─── 段点 y 地面化决策（core 纯逻辑，mc 层负责世界查询） ───

/** 单格方块类别（mc 层世界查询结果；采用可序列化的布尔视图） */
export interface WaypointYBlockInfo {
  /** 是否空气 */
  isAir: boolean;
  /** 是否液体（水/熔岩等） */
  isLiquid: boolean;
}

/** 段点 y 修正结果：keep=保持插值 y（空气/水/不可查询/超上限降级）；
 *  raise=上移到空气层（y = 修正后的空气方块 y） */
export type WaypointYAdjustment = { kind: "keep" } | { kind: "raise"; y: number };

/**
 * 段点 y 地面化决策（**回退路径**：高位 y 导航不被引擎接受时使用；core 纯函数）：
 *   navigateToLocation(target) 的引擎语义 =「寻路到低于目标 y 的第一层地面」，
 *   因此回退目标 y 必须是空气层：
 *   - targetY 处是空气 → 可用（keep）
 *   - targetY 处是非空气且非水（实心，=埋在方块里）→ 向上重算到第一个空气
 *     方块（raise；上限 raiseLimit，超限降级 keep）
 *   - targetY 处是水（液体）→ 不调整（keep）
 *   - query 返回 undefined（区块未加载/越界/异常）→ 降级 keep
 *
 * @param query      方块类别查询（y → 类别；不可查询返回 undefined）
 * @param targetY    插值段点的 y
 * @param raiseLimit 向上最大重算格数（防御死循环）
 * @returns 修正结果
 */
export function decideWaypointY(
  query: (y: number) => WaypointYBlockInfo | undefined,
  targetY: number,
  raiseLimit: number,
): WaypointYAdjustment {
  const at = query(Math.floor(targetY));
  if (!at || at.isAir || at.isLiquid) return { kind: "keep" };
  // 埋在实心方块：向上逐格找第一个空气（跨区块边界 → 降级保留）
  for (let y = Math.floor(targetY) + 1; y <= Math.floor(targetY) + raiseLimit; y++) {
    const b = query(y);
    if (!b) return { kind: "keep" };
    if (b.isAir) return { kind: "raise", y };
  }
  return { kind: "keep" }; // 超上调上限仍未找到空气 → 降级
}
