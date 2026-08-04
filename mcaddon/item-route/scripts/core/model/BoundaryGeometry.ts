// ─── 边界棱线几何（纯函数，零 MC 依赖，可单测） ──────────────
/** 棱线采样步长 */
export const STEP = 0.6;

/** 计算立方体 12 条棱上的采样点（平铺坐标网格） */
export function edgePoints(
  area: { corner1: { x: number; y: number; z: number }; corner2: { x: number; y: number; z: number } },
  step: number = STEP
): Array<{ x: number; y: number; z: number }> {
  const x1 = Math.min(area.corner1.x, area.corner2.x);
  const x2 = Math.max(area.corner1.x, area.corner2.x);
  const y1 = Math.min(area.corner1.y, area.corner2.y);
  const y2 = Math.max(area.corner1.y, area.corner2.y);
  const z1 = Math.min(area.corner1.z, area.corner2.z);
  const z2 = Math.max(area.corner1.z, area.corner2.z);
  const pts: Array<{ x: number; y: number; z: number }> = [];
  const lerp = (a: number, b: number): number[] => {
    const out: number[] = [];
    for (let v = a; v <= b + 1e-6; v += step) out.push(Math.floor(v));
    if (out[out.length - 1] !== b) out.push(b);
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