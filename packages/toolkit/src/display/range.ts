// ─── 范围条件显示（纯逻辑，零 @minecraft，可 node 单测） ──
// HudSource.targets 配合本函数做"范围内才显示"的声明式判定；
// 也支持任意逐玩家条件（不在范围内 → targets 返回 false → 不被覆盖、不参与仲裁）。

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 供判距的最小玩家形状（.location / .dimension.id 即可，便于 mock 测试） */
export interface RangeProbe {
  location: Vec3;
  dimension: { id: string };
}

/** 中心点（含维度）：跨维度一律视为不在范围内 */
export interface RangeCenter extends Vec3 {
  dimensionId: string;
}

/**
 * 玩家是否在中心点 radius 米（立方体包围盒）内。
 * 跨维度直接返回 false；距离取三个轴向差平方和（免开方）。
 *
 * @param player  - 玩家（仅读 location/dimension，可传 mock）
 * @param center  - 中心点与维度
 * @param radius  - 半径（米）
 * @returns true = 范围内（同维度且三个轴向差均在 radius 内）
 */
export function isWithinRange(player: RangeProbe, center: RangeCenter, radius: number): boolean {
  if (player.dimension.id !== center.dimensionId) return false;
  const dx = player.location.x - center.x;
  const dy = player.location.y - center.y;
  const dz = player.location.z - center.z;
  const r = radius * radius;
  return dx * dx + dy * dy + dz * dz <= r;
}