// ─── 长途寻路分段（core 层纯函数） ─────────────────────
// 官方 API（navigateToLocation）无距离上限参数，引擎远距离导航易失败/卡死
// （已知问题）——长途寻路用分段接力：目标路径按单段最远距离切段，
// 逐段独立寻路（段内障碍由引擎绕行），段间无缝衔接。
// 本模块只做几何切段（纯函数，零 @minecraft 依赖），执行在 mc 层。

import type { Vec3 } from "../Types";

/** 长途寻路单段最远距离（格，水平）——与短程寻路限制一致 */
export const LONG_NAV_SEGMENT_DISTANCE = 16;

/**
 * 长途寻路分段（纯几何）：起点 → 终点按水平距离等分切段，
 * 每段水平距离 ≤ maxSegment（缺省 16），最后一段自动收尾。
 * 垂直（y）随水平进度线性插值——避免段尾悬空/埋墙导致的寻路失败。
 *
 * @param start 起点（假人当前位置）
 * @param target 终点（长途目标）
 * @param maxSegment 单段最远水平距离（格；缺省 16）
 * @returns 分段路径点列表（含最后一段 = 终点；水平距离 ≤16 时单点直达）
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
