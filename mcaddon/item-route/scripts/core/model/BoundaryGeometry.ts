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
 * @param area - 立方体区域（角点乱序自动纠正）
 * @param step - 采样步长（默认 STEP=0.6）
 * @returns 去重前的棱线采样点数组
 */
export function edgePoints(area: Box, step: number = STEP): Array<{ x: number; y: number; z: number }> {
  const x1 = Math.min(area.corner1.x, area.corner2.x);
  const x2 = Math.max(area.corner1.x, area.corner2.x);
  const y1 = Math.min(area.corner1.y, area.corner2.y);
  const y2 = Math.max(area.corner1.y, area.corner2.y);
  const z1 = Math.min(area.corner1.z, area.corner2.z);
  const z2 = Math.max(area.corner1.z, area.corner2.z);
  const pts: Array<{ x: number; y: number; z: number }> = [];
  // 沿一维 [a,b] 以 step 内插出采样值；浮点误差容差 1e-6，末值强制等于 b（含角点）。
  // ⚠️ 外边界取 **b+1**（方块在位置 b 占 [b, b+1)，边界光幕应框住最外层面，item 2.2 修复）。
  const lerp = (a: number, b: number): number[] => {
    const out: number[] = [];
    for (let v = a; v <= b + 1 + 1e-6; v += step) out.push(Math.floor(v));
    if (out[out.length - 1] !== b + 1) out.push(b + 1);
    return out;
  };
  // 底面/顶面 4 条棱（X 方向 + Z 方向）
  for (const y of [y1, y2]) {
    for (const z of [z1, z2]) for (const x of lerp(x1, x2)) pts.push({ x, y, z });
    for (const x of [x1, x2]) for (const z of lerp(z1, z2)) pts.push({ x, y, z });
  }
  // 4 条竖棱
  for (const x of [x1, x2]) for (const z of [z1, z2]) for (const y of lerp(y1, y2)) pts.push({ x, y, z });
  return pts;
}
