// ─── 调试线框的几何计算(纯函数,可脱离游戏单测) ────────────────
//
// 形状对象本身由 `@minecraft/debug-utilities` 的原生类构造,在 node 里跑不了;
// 但「三色轴该画多长、从哪画到哪、文字摆在哪、尺寸怎么写」全是纯算术,
// 抽到这里就能直接单测,不必进游戏试。
//
// 本文件不导入任何 @minecraft/* 模块。

import type { BoxShape } from "./BoxGeometry";

/** 坐标轴线段长度上限(格);盒子很小时按边长收缩 */
export const AXIS_MAX_LENGTH = 4;

/** 三个轴的名字 */
export const AXES = ["x", "y", "z"] as const;

/** 轴名 */
export type AxisName = (typeof AXES)[number];

/** 一个三维点(与 Vector3 结构一致,但不依赖官方类型) */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 一条坐标轴线段 */
export interface AxisSegment {
  /** 该线段沿哪个轴 */
  axis: AxisName;
  /** 起点:盒子的最小角 */
  start: Point3;
  /** 终点:沿轴伸出后的位置 */
  end: Point3;
  /** 线段长度(格) */
  length: number;
}

/** 把数值夹到区间内 */
export function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** 尺寸文字:如 `10×8×10` */
export function describeSize(shape: BoxShape): string {
  return `${shape.size.x}×${shape.size.y}×${shape.size.z}`;
}

/**
 * 三条坐标轴线段,都从盒子最小角出发,沿各自轴向伸出。
 *
 * 长度取 `min(AXIS_MAX_LENGTH, 该轴边长)`:大盒子不必画出四格以上的轴,
 * 单格选区也不该让轴伸出盒子外面太远(那会让人误以为框选范围更大)。
 */
export function axisSegments(shape: BoxShape, maxLength: number = AXIS_MAX_LENGTH): AxisSegment[] {
  return AXES.map((axis) => {
    const start: Point3 = { ...shape.min };
    const length = Math.min(maxLength, shape.size[axis]);
    const end: Point3 = { ...start };
    end[axis] = start[axis] + length;
    return { axis, start, end, length };
  });
}

/**
 * 尺寸文字的位置:盒子上方一格的水平中心。
 *
 * 抬高一格是为了避开顶面棱线;DebugText 始终朝向屏幕,不需要额外朝向计算。
 */
export function labelPosition(shape: BoxShape): Point3 {
  return { x: shape.center.x, y: shape.max.y + 1, z: shape.center.z };
}
