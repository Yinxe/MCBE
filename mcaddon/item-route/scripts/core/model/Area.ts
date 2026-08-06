// ─── 区域包含与邻近判定（纯函数，零 MC 依赖，可单测） ──────
// 两处消费者：
//   · McProximityChecker —— 调度激活：仓库中心 16 格内有玩家 → 激活分拣
//   · McEventBridge —— 事件过滤：方块坐标 → 所属仓库/容器
// 注意 `isPlayerNearby` 以**区域中心**为圆心（非最近棱），是简化判定；
// 调度激活只需"玩家是否大致在场"，无需精确到边界距离。
import type { WarehouseArea } from "./Warehouse";
import type { Warehouse } from "./Warehouse";
import type { Container } from "./Container";
import type { Location } from "./types";
import { locationKey } from "./types";

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

/** 区域 XZ 外接圆半径（从中心到最远角，直线距离参考点） */
export function areaCircumradius(area: WarehouseArea): number {
  const dx = Math.max(area.corner1.x, area.corner2.x) - Math.min(area.corner1.x, area.corner2.x);
  const dz = Math.max(area.corner1.z, area.corner2.z) - Math.min(area.corner1.z, area.corner2.z);
  return Math.hypot(dx / 2, dz / 2);
}

/**
 * 是否有玩家在仓库中心直线距离 ≤ (外接圆半径 + margin) 内（按维度过滤）。
 * 用中心直线距离而非固定格数（v1 口径）：仓库很大时，玩家身处区域内部、
 * 但距中心超过固定值，也能正确判定"在场"（否则大仓永远不激活）。
 */
export function isPlayerNearby(area: WarehouseArea, players: PlayerPosition[], margin: number): boolean {
  const cx = (Math.min(area.corner1.x, area.corner2.x) + Math.max(area.corner1.x, area.corner2.x)) / 2;
  const cz = (Math.min(area.corner1.z, area.corner2.z) + Math.max(area.corner1.z, area.corner2.z)) / 2;
  const radius = areaCircumradius(area) + margin;
  return players.some((p) => p.dimension === area.dimension && Math.hypot(p.x - cx, p.z - cz) <= radius);
}

// ─── 仓库/容器定位（事件桥接过滤谓词，零 MC 依赖） ─────────

/** 维度 + 坐标 → 所属仓库（仅区域判定，容器未注册也能命中） */
export function findWarehouseAt(warehouses: Warehouse[], dimension: string, loc: Location): Warehouse | undefined {
  return warehouses.find((w) => containsLocation(w.area, dimension, loc));
}

/**
 * 距玩家最近、且玩家具备指定权限的仓库（同维度，按区域中心直线距离）。
 * 用于搜索等"就近 + 权限"业务：只对玩家有权限的仓库操作。
 */
export function nearestWarehouseByPermission(
  warehouses: Warehouse[],
  dimension: string,
  playerPos: { x: number; z: number },
  authorized: (w: Warehouse) => boolean
): Warehouse | undefined {
  let best: Warehouse | undefined;
  let bestDist = Infinity;
  for (const w of warehouses) {
    if (w.area.dimension !== dimension || !authorized(w)) continue;
    const cx = (Math.min(w.area.corner1.x, w.area.corner2.x) + Math.max(w.area.corner1.x, w.area.corner2.x)) / 2;
    const cz = (Math.min(w.area.corner1.z, w.area.corner2.z) + Math.max(w.area.corner1.z, w.area.corner2.z)) / 2;
    const dist = Math.hypot(playerPos.x - cx, playerPos.z - cz);
    if (dist < bestDist) {
      bestDist = dist;
      best = w;
    }
  }
  return best;
}

/**
 * 维度 + 坐标 → 仓库 + 逻辑容器（occupiedLocations 匹配，含双箱任一半）。
 * 基于"容器自述归属"（Container.warehouseId）：先按**区域**定位所属仓库（O(仓库数)），
 * 再在该仓容器内按坐标命中；并校验容器自述 warehouseId 与区域仓库一致（防串仓）。
 */
export function findContainerAt(
  warehouses: Warehouse[],
  dimension: string,
  loc: Location
): { warehouse: Warehouse; container: Container } | undefined {
  const warehouse = findWarehouseAt(warehouses, dimension, loc);
  if (warehouse === undefined) return undefined;
  for (const c of warehouse.containers.values()) {
    // 归属确认：容器自述 warehouseId 应与区域仓库一致（registerContainer 已装入，正常恒等）
    if (c.warehouseId !== undefined && c.warehouseId !== warehouse.id) continue;
    if (c.occupiedLocations.some((l) => locationKey(l) === locationKey(loc))) {
      return { warehouse, container: c };
    }
  }
  return undefined;
}
