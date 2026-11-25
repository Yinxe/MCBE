// ─── 框选几何:两角点 → 盒子中心与尺寸(纯函数,可脱离游戏单测) ────
//
// 框选的口径是**方块**而不是坐标点:给出两个方块坐标,框住的是这两个方块
// 各自占据的整个单位立方体,因此盒子在三个轴上的尺寸是 |Δ| + 1,中心落在
// (min + max + 1) / 2 而不是 (min + max) / 2。若按后者算,框会整体偏半个方块。
//
// 本文件不导入任何 @minecraft/server 类型,便于在 node 里直接测。

/** 整数方块坐标 */
export interface BlockPosition {
  x: number;
  y: number;
  z: number;
}

/** 盒子在空间中的位置与尺寸 */
export interface BoxShape {
  /** 盒子几何中心(世界坐标,含小数) */
  center: { x: number; y: number; z: number };
  /** 三个轴上的边长(格),恒为正 */
  size: { x: number; y: number; z: number };
  /** 两角点规整后的最小角(方块坐标) */
  min: BlockPosition;
  /** 两角点规整后的最大角(方块坐标) */
  max: BlockPosition;
  /** 体积(方块数),用于提示玩家框了多少格 */
  volume: number;
}

/** 单轴边长上限(格)。超过时拒绝绘制,避免出现无法辨认的巨大面片。 */
export const MAX_BOX_EDGE = 256;

/**
 * 把两个角点规整成盒子形状。
 *
 * 角点允许是带小数的坐标(命令的 Location 参数可以直接写 `100.7 64.2 -20.9`,
 * 也可以用 `~` 相对坐标),这里先按所在方块取整 —— 用 `Math.floor` 而不是截断:
 * 负坐标下截断会把 -20.9 算成 -20,而该位置实际属于 -21 号方块。
 *
 * 两个角点的传入顺序无关;逐轴取 min / max 即可。
 */
export function boxFromCorners(cornerA: BlockPosition, cornerB: BlockPosition): BoxShape {
  const a = toBlockPosition(cornerA);
  const b = toBlockPosition(cornerB);
  const min: BlockPosition = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    z: Math.min(a.z, b.z),
  };
  const max: BlockPosition = {
    x: Math.max(a.x, b.x),
    y: Math.max(a.y, b.y),
    z: Math.max(a.z, b.z),
  };

  // +1:两个方块之间的格子数包含两端,例如 x=0 与 x=2 框住 0/1/2 共 3 格
  const size = {
    x: max.x - min.x + 1,
    y: max.y - min.y + 1,
    z: max.z - min.z + 1,
  };

  return {
    center: {
      x: min.x + size.x / 2,
      y: min.y + size.y / 2,
      z: min.z + size.z / 2,
    },
    size,
    min,
    max,
    volume: size.x * size.y * size.z,
  };
}

/** 把任意坐标取整到所在方块 */
export function toBlockPosition(position: BlockPosition): BlockPosition {
  return {
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z),
  };
}

/** 盒子某一轴的边长是否超出可绘制上限 */
export function exceedsMaxEdge(shape: BoxShape): boolean {
  return shape.size.x > MAX_BOX_EDGE || shape.size.y > MAX_BOX_EDGE || shape.size.z > MAX_BOX_EDGE;
}
