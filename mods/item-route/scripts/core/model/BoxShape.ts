// ─── 盒子几何（纯函数，零 MC 依赖，可单测） ──────────────────
// 把仓库区域换成 box 粒子需要的「中心 + 三轴边长」。
//
// ⚠️ 口径关键：框住的是**方块本体**，不是坐标点。区域块占 [min, max]，
// 其外表面在 max+1，所以中心是 (min + max + 1) / 2 而不是 (min + max) / 2；
// 若用后者，整个框会偏移半格。这与 `BoxGeometry.boxFromCorners` 同口径。
import type { WarehouseArea } from "./Warehouse";
import type { Location } from "./types";

/** 盒子在空间中的位置与尺寸（供 box 粒子用） */
export interface BoxShape {
  /** 盒子几何中心（世界坐标，含小数） */
  center: { x: number; y: number; z: number };
  /** 三个轴上的边长（格），恒为正 */
  size: { x: number; y: number; z: number };
  /** 两角归一化后的最小角（方块坐标） */
  min: Location;
  /** 两角归一化后的最大角（方块坐标） */
  max: Location;
}

/**
 * 仓库区域 → 盒子形状。
 *
 * 角点乱序自动纠正（逐轴 min/max），与 `areaFromAnchors` 同口径。
 *
 * @param area - 仓库区域（两角可能乱序）
 * @returns 盒子中心与尺寸
 */
export function boxFromArea(area: WarehouseArea): BoxShape {
  const min: Location = {
    x: Math.min(area.corner1.x, area.corner2.x),
    y: Math.min(area.corner1.y, area.corner2.y),
    z: Math.min(area.corner1.z, area.corner2.z),
  };
  const max: Location = {
    x: Math.max(area.corner1.x, area.corner2.x),
    y: Math.max(area.corner1.y, area.corner2.y),
    z: Math.max(area.corner1.z, area.corner2.z),
  };
  return {
    // +1：框住的是方块本体，块在 max 占 [max, max+1)，故中心落在 (min + max + 1) / 2
    center: {
      x: (min.x + max.x + 1) / 2,
      y: (min.y + max.y + 1) / 2,
      z: (min.z + max.z + 1) / 2,
    },
    // 含两端：x=0 与 x=2 框住 0/1/2 共 3 格
    size: {
      x: max.x - min.x + 1,
      y: max.y - min.y + 1,
      z: max.z - min.z + 1,
    },
    min,
    max,
  };
}
