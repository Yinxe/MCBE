// ─── 单次随机游走（移动功能模块） ──────────────────────
// 随机游走终点选择（纯函数，可单测）：在水平半径内随机挑一个近点
// （官方随机游走语义：目标就在附近，不计算 16 格之外）。
// 高度由调用方（mc 层）按地面修正；纯函数只负责水平随机 + 中心 y。

import type { Vec3 } from "../../rules/Types";

/** 随机游走默认水平半径（格）：近点游走 */
export const STROLL_DEFAULT_RADIUS = 8;

/**
 * 随机游走终点（纯逻辑）：水平半径内均匀随机一个近点（含中心 y）。
 * @param center 假人当前位置
 * @param radius 水平半径（格）
 * @param rng 随机源（测试注入；缺省 Math.random）
 * @returns 随机点（x/z 为方块中心 +0.5；y = 中心 y——由 mc 层按地面修正）
 */
export function pickRandomStrollPoint(center: Vec3, radius: number = STROLL_DEFAULT_RADIUS, rng: () => number = Math.random): Vec3 {
  const dx = Math.floor(rng() * (radius * 2 + 1)) - radius;
  const dz = Math.floor(rng() * (radius * 2 + 1)) - radius;
  return { x: Math.floor(center.x) + dx + 0.5, y: center.y, z: Math.floor(center.z) + dz + 0.5 };
}

/** 随机游走单次执行选项 */
export interface RandomStrollOptions {
  /** 水平半径（格；缺省 STROLL_DEFAULT_RADIUS） */
  radius?: number;
  /** 导航速度（缺省 1；散步可传慢速如 0.6） */
  speed?: number;
}
