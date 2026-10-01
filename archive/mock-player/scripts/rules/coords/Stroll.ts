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

/** 随机游走默认水平半径（格）：单点游走（不计算 16 格之外） */
export const STROLL_DEFAULT_RADIUS = 8;
/** 随机游走路线默认总范围（格）：路线模式所有路径点在此半径圆内
 * （用户拍板：总范围 16——恰为直达导航上限，分段导航可覆盖） */
export const STROLL_DEFAULT_ROUTE_RADIUS = 16;
/** 候选采样次数（官方：随机挑选 10 个位置） */
export const STROLL_CANDIDATE_SAMPLES = 10;
/** 随机游走默认最小选点距离（格）：低于此距离的点看起来原地忽走忽停，
 *  不自然（真实生物散步至少走出几步） */
export const STROLL_MIN_DISTANCE = 3;

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
  /** 最小选点距离（格；缺省 STROLL_MIN_DISTANCE——太近的点会原地踱步） */
  minDist?: number;
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
 * 其余概率全向随机。距离在 [minDist, max(minDist, radius)] 均匀——
 * **minDist 排除过近点**（<minDist 的点走一两步就到，原地踱步不自然）。
 * @param center 假人当前位置
 * @param yawDeg 当前偏航（度；MCBE：0 = 面向 +Z 南，顺时针增加）
 * @param radius 水平半径（格）
 * @param rng 随机源（测试注入）
 * @param bias 朝向方向采样概率（缺省 0.6——六成概率朝转身方向）
 * @param spreadDeg 朝向方向扩散角（缺省 ±60°）
 * @param minDist 最小选点距离（格；缺省 0——纯逻辑默认不限制，调用方
 *        按产品语义传入 STROLL_MIN_DISTANCE 等）
 */
export function pickDirectionalStrollPoint(
  center: Vec3,
  yawDeg: number,
  radius: number = STROLL_DEFAULT_RADIUS,
  rng: () => number = Math.random,
  bias = 0.6,
  spreadDeg = 60,
  minDist = 0,
): Vec3 {
  const angleDeg = rng() < bias ? yawDeg + (rng() * 2 - 1) * spreadDeg : rng() * 360;
  const rad = (angleDeg * Math.PI) / 180;
  const hi = Math.max(minDist, radius); // radius < minDist（异常配置）→ 固定 minDist 距离
  const dist = minDist + Math.floor(rng() * (hi - minDist + 1)); // minDist..hi 均匀
  // MCBE 朝向向量：(-sin(yaw), 0, cos(yaw))——yaw=0 面向 +Z
  return {
    x: Math.floor(center.x) + 0.5 + -Math.sin(rad) * dist,
    y: center.y,
    z: Math.floor(center.z) + 0.5 + Math.cos(rad) * dist,
  };
}

/** 随机游走路线选项（路线模式） */
export interface StrollRouteOptions {
  /** 总范围（格，以起点为圆心；缺省 STROLL_DEFAULT_ROUTE_RADIUS=16） */
  radius?: number;
  /** 最小选点距离（格；缺省 STROLL_MIN_DISTANCE=3） */
  minDist?: number;
  /** 路径点数下限（缺省 0——用户拍板 0~3：生成 0 个点 = 本次保持不动） */
  pointMin?: number;
  /** 路径点数上限（缺省 3——用户拍板：每次最多 3 个路径点） */
  pointMax?: number;
  /** 随机源（测试注入；缺省 Math.random） */
  rng?: () => number;
}

/**
 * 随机游走路线生成（路线模式：每次游走 0~3 个路径点，全部落在以起点为
 * 圆心、radius 为半径的圆内——总范围；**只看水平距离，不考虑 y**（y 保留
 * 起点高度，可站立修正由 mc 层世界查询负责）；生成 0 个点 = 本次保持不动。
 * 方向语义（对齐朝向偏置选点）：
 *   - 第 1 点：六成概率朝转身方向（yawDeg ±60°），其余全向——转身带动游走
 *   - 后续点：以"前一点相对起点的方向"为基础 ±60° 顺延——路径向外延展、
 *     不折返（像真实生物的散步路线）；距离 [minDist, radius] 均匀。
 * @param center 假人当前位置（路线圆心）
 * @param yawDeg 当前偏航（度；MCBE：0 = 面向 +Z 南，顺时针增加）
 * @param options 范围/点数/随机源
 */
export function generateStrollRoute(
  center: Vec3,
  yawDeg: number,
  options: StrollRouteOptions = {},
): Vec3[] {
  const radius = options.radius ?? STROLL_DEFAULT_ROUTE_RADIUS;
  const minDist = options.minDist ?? STROLL_MIN_DISTANCE;
  const pointMin = options.pointMin ?? 0;
  const pointMax = options.pointMax ?? 3;
  const rng = options.rng ?? Math.random;
  const count = pointMin + Math.floor(rng() * (pointMax - pointMin + 1));

  const points: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    let angleDeg: number;
    if (i === 0) {
      // 第 1 点：六成概率朝转身方向（同 pickDirectionalStrollPoint 语义）
      angleDeg = rng() < 0.6 ? yawDeg + (rng() * 2 - 1) * 60 : rng() * 360;
    } else {
      // 后续点：以前一点相对起点的方向为基础顺延（MCBE yaw 反推：
      //   yaw = atan2(-dx, dz)；±60° 扩散——路径自然延展不折返）
      const prev = points[i - 1]!;
      const baseYaw = (Math.atan2(-(prev.x - center.x), prev.z - center.z) * 180) / Math.PI;
      angleDeg = rng() < 0.7 ? baseYaw + (rng() * 2 - 1) * 60 : rng() * 360;
    }
    const rad = (angleDeg * Math.PI) / 180;
    const dist = minDist + Math.floor(rng() * (radius - minDist + 1)); // minDist..radius 均匀
    points.push({
      x: center.x + -Math.sin(rad) * dist,
      y: center.y,
      z: center.z + Math.cos(rad) * dist,
    });
  }
  return points;
}
