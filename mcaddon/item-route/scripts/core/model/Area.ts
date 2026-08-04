// ─── 区域包含与邻近判定（纯函数，零 MC 依赖，可单测） ──────
import type { WarehouseArea } from "./Warehouse";
import type { Location } from "./types";

/** 位置是否位于仓库区域内（维度匹配 + 三轴区间内，边界含） */
export function containsLocation(area: WarehouseArea, dimension: string, loc: Location): boolean {
  if (area.dimension !== dimension) return false;
  const minX = Math.min(area.corner1.x, area.corner2.x);
  const maxX = Math.max(area.corner1.x, area.corner2.x);
  const minY = Math.min(area.corner1.y, area.corner2.y);
  const maxY = Math.max(area.corner1.y, area.corner2.y);
  const minZ = Math.min(area.corner1.z, area.corner2.z);
  const maxZ = Math.max(area.corner1.z, area.corner2.z);
  return loc.x >= minX && loc.x <= maxX && loc.y >= minY && loc.y <= maxY && loc.z >= minZ && loc.z <= maxZ;
}

/** 玩家位置（维度 + XZ 坐标） */
export interface PlayerPosition {
  dimension: string;
  x: number;
  z: number;
}

/** 是否有玩家在仓库区域中心 XZ 距离 range 内（按维度过滤） */
export function isPlayerNearby(area: WarehouseArea, players: PlayerPosition[], range: number): boolean {
  const cx = (Math.min(area.corner1.x, area.corner2.x) + Math.max(area.corner1.x, area.corner2.x)) / 2;
  const cz = (Math.min(area.corner1.z, area.corner2.z) + Math.max(area.corner1.z, area.corner2.z)) / 2;
  return players.some((p) => p.dimension === area.dimension && Math.hypot(p.x - cx, p.z - cz) <= range);
}