import type { BlockLocation, WarehouseArea } from "../types";

/**
 * 生成坐标位置键，用于在 Map 中快速索引和查找容器。
 * 格式为 "维度ID|x|y|z"，确保每个维度的每个方块位置都有唯一的字符串键。
 *
 * @param dimensionId - 维度 ID
 * @param location - 方块坐标
 * @returns 唯一位置键字符串
 */
export function locationKey(dimensionId: string, location: BlockLocation): string {
  return `${dimensionId}|${location.x}|${location.y}|${location.z}`;
}

/**
 * 将两个对角坐标归一化为标准的 WarehouseArea。
 * 通过对各分量分别取 min/max，确保 area.min 各分量 <= area.max 各分量，
 * 便于后续的区域包含判断和体积计算。
 *
 * @param a - 第一个角坐标
 * @param b - 第二个角坐标
 * @returns 归一化后的仓库区域
 */
export function normalizeArea(a: BlockLocation, b: BlockLocation): WarehouseArea {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

/**
 * 计算仓库区域的体积（包含的方块总数）。
 * 公式为 (max - min + 1) 在各轴上的乘积，+1 是因为坐标是包含的区间。
 *
 * @param area - 仓库区域
 * @returns 方块数量
 */
export function areaVolume(area: WarehouseArea): number {
  return (area.max.x - area.min.x + 1) * (area.max.y - area.min.y + 1) * (area.max.z - area.min.z + 1);
}

/**
 * 判断给定坐标是否位于仓库区域内部（包含边界）。
 * 各分量均在 [min, max] 闭区间内即视为在区域内。
 *
 * @param location - 待检查的方块坐标
 * @param area - 仓库区域
 * @returns 是否在区域内
 */
export function isInsideArea(location: BlockLocation, area: WarehouseArea): boolean {
  return (
    location.x >= area.min.x &&
    location.x <= area.max.x &&
    location.y >= area.min.y &&
    location.y <= area.max.y &&
    location.z >= area.min.z &&
    location.z <= area.max.z
  );
}

/**
 * 比较两个方块坐标，用于确定"主要位置"（primary location）的排序。
 * 排序顺序：先按 x 轴、再按 z 轴、最后按 y 轴。
 * 这种排序策略使坐标在水平方向上优先排列，适用于多格容器的主坐标选择。
 *
 * @param a - 第一个坐标
 * @param b - 第二个坐标
 * @returns 负数（a 更小）、0（相等）、正数（a 更大）
 */
export function compareLocationForPrimary(a: BlockLocation, b: BlockLocation): number {
  if (a.x !== b.x) return a.x - b.x;
  if (a.z !== b.z) return a.z - b.z;
  return a.y - b.y;
}

/**
 * 检查两个仓库区域之间是否存在重叠或间距不足。
 *
 * 判断逻辑：将两个区域各向四周扩展 `spacing` 格后，检查三个轴向上是否全部交集。
 * 如果三个轴向上都有交集，则说明间距不足或存在重叠。
 *
 * @param a - 第一个仓库区域
 * @param b - 第二个仓库区域
 * @param spacing - 要求的最小间距（方块数）
 * @returns 如果区域间距不足（小于 spacing）或重叠，返回 true
 */
export function areasTooClose(a: WarehouseArea, b: WarehouseArea, spacing: number): boolean {
  return (
    a.min.x - spacing <= b.max.x &&
    a.max.x + spacing >= b.min.x &&
    a.min.y - spacing <= b.max.y &&
    a.max.y + spacing >= b.min.y &&
    a.min.z - spacing <= b.max.z &&
    a.max.z + spacing >= b.min.z
  );
}
