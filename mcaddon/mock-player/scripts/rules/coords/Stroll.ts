// ─── 单次随机游走（官方陆地目标算法，纯逻辑部分可单测） ──
// wiki 寻路页「随机游走」节（用户要求与 wiki 保持一致）：
//   陆地目标算法步骤：
//     1. 随机挑选 10 个位置（高度范围 + 水平范围随机方向）
//     2. 筛选：高度边界 / 下方是**稳定方块**（遮挡形状完整）/
//       目标为固体 → 高度向上修正到非固体 / 修正后为水 → 无效
//     3. 挑选**行走目标值最大**的位置作为终点
// 本文件为纯逻辑部分（候选挑选决策/稳定方块判定/行走目标值公式）；
// 世界查询（getBlock）在 mc 层（move.ts randomStrollOnce 采样）。

import type { Vec3 } from "../../rules/Types";

/** 随机游走默认水平半径（格）：近点游走（不计算 16 格之外） */
export const STROLL_DEFAULT_RADIUS = 8;
/** 候选采样次数（官方：随机挑选 10 个位置） */
export const STROLL_CANDIDATE_SAMPLES = 10;

/** 单次候选采样结果（点 + 行走目标值偏好） */
export interface StrollCandidate {
  point: Vec3;
  /** 行走目标值（官方：生物对随机游走目标的偏好程度；越大越易被选为终点） */
  walkValue: number;
}

/** 草方块行走目标值加成（官方动物语义：对草方块偏好 10） */
export const GRASS_BLOCK_BONUS = 10;

/**
 * 官方位置行走目标值（主世界环境光照 a=15 代入）：
 * (60a-4ai+i)/(60-3i)-0.5 = i/(60-3i)-0.5
 * 内部光照 i ∈ [0,15] 单调递增，i=12 为零点（越亮越优先）。
 */
export function strollWalkValue(lightLevel: number): number {
  return lightLevel / (60 - 3 * lightLevel) - 0.5;
}

/** 非稳定方块 typeId 特征（遮挡形状不完整：台阶/楼梯/玻璃/地毯等） */
const UNSTABLE_MARKERS = [
  "_stairs", "_slab", "glass", "_carpet", "_fence", "_trapdoor", "_button", "_pressure_plate",
  "_rail", "_sign", "_banner", "_torch", "_flower", "_mushroom", "_sapling", "_coral",
  "snow_layer", "vine", "ladder", "short_grass", "tall_grass", "fern", "deadbush",
  "bamboo", "sugar_cane", "cactus", "chorus_flower", "turtle_egg",
];

/**
 * 稳定方块判定（官方：遮挡形状必须是完整方块——单层台阶/楼梯/玻璃等
 * 不完整方块不能作为随机游走终点下方的方块）。
 * @param typeId 下方方块 typeId（空气/液体由调用方先行排除）
 */
export function isStableBlockType(typeId: string): boolean {
  return !UNSTABLE_MARKERS.some((m) => typeId.includes(m));
}

/**
 * 游走终点选择（官方陆地目标算法决策核心）：
 * 从候选采样中挑选**行走目标值最大**的作为终点；全部无效 → undefined。
 * @param samples 候选采样（无效候选 = undefined，mc 层过滤）
 * @param sampleCount 期望采样次数（官方 10）
 */
export function selectStrollTarget(
  samples: readonly (StrollCandidate | undefined)[],
  sampleCount: number = STROLL_CANDIDATE_SAMPLES,
): Vec3 | undefined {
  let best: StrollCandidate | undefined;
  for (let i = 0; i < Math.min(samples.length, sampleCount); i++) {
    const candidate = samples[i];
    if (!candidate) continue;
    if (!best || candidate.walkValue > best.walkValue) best = candidate;
  }
  return best?.point;
}

/** 随机游走单次执行选项 */
export interface RandomStrollOptions {
  /** 水平半径（格；缺省 STROLL_DEFAULT_RADIUS） */
  radius?: number;
  /** 导航速度（缺省 1；散步可传慢速如 0.6） */
  speed?: number;
}

/**
 * 随机水平方向（官方：水平范围随机；含中心 y）。
 * @param center 假人当前位置
 * @param radius 水平半径（格）
 * @param rng 随机源（测试注入；缺省 Math.random）
 */
export function pickRandomStrollPoint(center: Vec3, radius: number = STROLL_DEFAULT_RADIUS, rng: () => number = Math.random): Vec3 {
  const dx = Math.floor(rng() * (radius * 2 + 1)) - radius;
  const dz = Math.floor(rng() * (radius * 2 + 1)) - radius;
  return { x: Math.floor(center.x) + dx + 0.5, y: center.y, z: Math.floor(center.z) + dz + 0.5 };
}

/**
 * 朝向偏置选点（官方行为：静止时的转身/扭头会带动下次游走方向——
 * 生物大概率朝当前朝向方向走）：
 * 以概率 bias 从当前偏航 ±spread 方向内采样（转身方向加权），
 * 其余概率全向随机。
 * @param center 假人当前位置
 * @param yawDeg 当前偏航（度；MCBE：0 = 面向 +Z 南，顺时针增加）
 * @param radius 水平半径（格）
 * @param rng 随机源（测试注入）
 * @param bias 朝向方向采样概率（缺省 0.6——六成概率朝转身方向）
 * @param spreadDeg 朝向方向扩散角（缺省 ±60°）
 */
export function pickDirectionalStrollPoint(
  center: Vec3,
  yawDeg: number,
  radius: number = STROLL_DEFAULT_RADIUS,
  rng: () => number = Math.random,
  bias = 0.6,
  spreadDeg = 60,
): Vec3 {
  const angleDeg = rng() < bias ? yawDeg + (rng() * 2 - 1) * spreadDeg : rng() * 360;
  const rad = (angleDeg * Math.PI) / 180;
  const dist = Math.floor(rng() * (radius + 1)); // 0..radius 均匀
  // MCBE 朝向向量：(-sin(yaw), 0, cos(yaw))——yaw=0 面向 +Z
  return {
    x: Math.floor(center.x) + 0.5 + -Math.sin(rad) * dist,
    y: center.y,
    z: Math.floor(center.z) + 0.5 + Math.cos(rad) * dist,
  };
}
