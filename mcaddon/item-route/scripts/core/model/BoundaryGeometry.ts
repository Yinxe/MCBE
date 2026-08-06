// ─── 边界棱线几何（纯函数，零 MC 依赖，可单测） ──────────────
/** 立方体区域（两对角角点；供棱线采样/边界粒子用） */
export interface Box {
  corner1: { x: number; y: number; z: number };
  corner2: { x: number; y: number; z: number };
}

/** 棱线采样步长 */
export const STEP = 0.6;

/**
 * 计算立方体 12 条棱上的采样点（平铺坐标网格，含角点）。
 * 算法：底面/顶面各 4 条棱（X 方向 + Z 方向）+ 4 条竖棱；每条棱以 step 步长内插，
 * 末尾补齐角点（浮点误差 1e-6 容差）。供 BoundaryDisplay 沿棱撒粒子用。
 *
 * ⚠️ 外表面口径（item 2.2 修复）：区域块占 [min, max]，其外表面在 **max+1**。故棱线框
 * 取 lo=[min,min,min]、hi=[max+1,max+1,max+1]——固定坐标与采样都落在 [min, max+1]，
 * 否则竖棱/远面会停留在旧 max 位置（棱线框不完整）。
 *
 * @param area - 立方体区域（角点乱序自动纠正）
 * @param step - 采样步长（默认 STEP=0.6）
 * @returns 去重前的棱线采样点数组
 */
export function edgePoints(area: Box, step: number = STEP): Array<{ x: number; y: number; z: number }> {
  const lo = {
    x: Math.min(area.corner1.x, area.corner2.x),
    y: Math.min(area.corner1.y, area.corner2.y),
    z: Math.min(area.corner1.z, area.corner2.z),
  };
  const hi = {
    x: Math.max(area.corner1.x, area.corner2.x) + 1, // 外表面（块在 max 占 [max, max+1)）
    y: Math.max(area.corner1.y, area.corner2.y) + 1,
    z: Math.max(area.corner1.z, area.corner2.z) + 1,
  };
  const pts: Array<{ x: number; y: number; z: number }> = [];
  // 沿一维 [a,b] 以 step 内插出采样值；浮点误差容差 1e-6，末值强制等于 b（含角点）。
  const lerp = (a: number, b: number): number[] => {
    const out: number[] = [];
    for (let v = a; v <= b + 1e-6; v += step) out.push(Math.floor(v));
    if (out[out.length - 1] !== b) out.push(b);
    return out;
  };
  // 底面/顶面 4 条棱（X 方向 + Z 方向）——固定坐标用 lo/hi（外表面）
  for (const y of [lo.y, hi.y]) {
    for (const z of [lo.z, hi.z]) for (const x of lerp(lo.x, hi.x)) pts.push({ x, y, z });
    for (const x of [lo.x, hi.x]) for (const z of lerp(lo.z, hi.z)) pts.push({ x, y, z });
  }
  // 4 条竖棱——固定坐标用 lo/hi（外表面），随区域 max+1 外扩
  for (const x of [lo.x, hi.x]) for (const z of [lo.z, hi.z]) for (const y of lerp(lo.y, hi.y)) pts.push({ x, y, z });
  return pts;
}
