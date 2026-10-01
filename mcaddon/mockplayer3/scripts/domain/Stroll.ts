// ─── 随机游走纯逻辑（domain） ────────
// 路线模式：每次 0~3 个路径点，水平全落半径圆内，相邻点水平距离 ≤12
// （直达导航上限 16，分居圆两侧两点可相距 ~32 致 too_far 中止整条路线）；
// 方向顺延不折返（0 点=本次保持不动）。选点只看水平，y 由地面修正归 engine。
// 路线选点不使用行走目标值：目标值与单点选点函数仅被测试引用。
// 世界查询在 engine StrollOps。
// 分步平滑转身：瞬移式 lookAt 拆为每 stepTicks tick 转 ≤ stepDeg° 的排程链（纯角度代数在此）。

import type { Vec3 } from "./Coords";

/** 随机游走默认水平半径（格，单点游走） */
export const STROLL_DEFAULT_RADIUS = 8;
/** 路线默认总范围（格，16 = 直达导航上限） */
export const STROLL_DEFAULT_ROUTE_RADIUS = 16;
/** 候选采样次数（官方陆地目标算法口径） */
export const STROLL_CANDIDATE_SAMPLES = 10;
/** 默认最小选点距离（格，剔除过近点） */
export const STROLL_MIN_DISTANCE = 3;
/** 路线相邻点间最大水平步距（格，直达导航上限 16 留余量） */
export const STROLL_ROUTE_STEP_MAX = 12;
/** 固体向上修正最大高度（格，防死循环） */
export const STROLL_MAX_RAISE = 8;
/** 草方块行走目标值加成（官方语义：偏好草方块） */
export const GRASS_BLOCK_BONUS = 10;

/** 单次候选采样结果（点 + 行走目标值偏好） */
export interface StrollCandidate {
  point: Vec3;
  /** 行走目标值（越大越易被选为终点） */
  walkValue: number;
}

/** 随机游走节奏/范围/转头配置 */
export interface WanderConfig {
  /** 游走间隔下限（引擎周期 = 10 tick） */
  intervalMin: number;
  /** 游走间隔上限（引擎周期） */
  intervalMax: number;
  /** 休息下限（引擎周期） */
  restMin: number;
  /** 休息上限（引擎周期） */
  restMax: number;
  /** 导航失败后快速重试等待（引擎周期） */
  failRetry: number;
  /** 单次游走总范围（格，路线所有点在此半径圆内） */
  radius: number;
  /** 单次游走最小选点距离（格，剔除过近点） */
  minDist: number;
  /** 路线路径点数下限（0 = 本次保持不动） */
  routePointsMin: number;
  /** 路线路径点数上限 */
  routePointsMax: number;
  /** 游走速度（慢速散步） */
  speed: number;
  /** 转头节流（引擎周期）：静止时偶尔扭头 */
  lookAroundInterval: number;
  /** 小幅扭头概率（0~1，其余为大幅随机转头） */
  lookSmallChance: number;
  /** 小幅扭头角度（±度）：当前朝向附近微调 */
  lookSmallSpread: number;
  /** 分步转身每步最大转角（度）：平滑转头 */
  lookTurnStepDeg: number;
  /** 分步转身步间间隔（tick） */
  lookTurnStepTicks: number;
}

/**
 * 默认配置（调参勿轻改）。节奏单位为引擎周期，能力侧乘 WANDER_CYCLE_TICKS
 * 换算 tick；lookTurnStepTicks 已是 tick。
 */
export const DEFAULT_WANDER_CONFIG: WanderConfig = {
  intervalMin: 3,
  intervalMax: 8,
  restMin: 2,
  restMax: 5,
  failRetry: 1,
  radius: 16,
  minDist: 3,
  routePointsMin: 0,
  routePointsMax: 3,
  speed: 0.6,
  lookAroundInterval: 8,
  lookSmallChance: 0.7,
  lookSmallSpread: 25,
  lookTurnStepDeg: 20,
  lookTurnStepTicks: 3,
};

/**
 * 官方位置行走目标值（主世界环境光 a=15 代入）：i/(60-3i)-0.5，
 * 内部光照 i∈[0,15] 单调递增，i=12 为零点（越亮越优先）。
 */
export function strollWalkValue(lightLevel: number): number {
  return lightLevel / (60 - 3 * lightLevel) - 0.5;
}

/** 非稳定方块 typeId 特征（遮挡形状不完整：台阶/楼梯/玻璃/地毯等） */
const UNSTABLE_MARKERS = [
  "_stairs",
  "_slab",
  "glass",
  "_carpet",
  "_fence",
  "_trapdoor",
  "_button",
  "_pressure_plate",
  "_rail",
  "_sign",
  "_banner",
  "_torch",
  "_flower",
  "_mushroom",
  "_sapling",
  "_coral",
  "snow_layer",
  "vine",
  "ladder",
  "short_grass",
  "tall_grass",
  "fern",
  "deadbush",
  "bamboo",
  "sugar_cane",
  "cactus",
  "chorus_flower",
  "turtle_egg",
];

/**
 * 稳定方块判定（官方：遮挡形状必须完整方块——不完整者不能作游走落脚点下方）。
 * @param typeId 下方方块 typeId（空气/液体由调用方先行排除）
 */
export function isStableBlockType(typeId: string): boolean {
  return !UNSTABLE_MARKERS.some((m) => typeId.includes(m));
}

/**
 * 游走终点选择（官方陆地目标算法决策核心）：候选中取行走目标值最大者；
 * 全无效返回 undefined。
 */
export function selectStrollTarget(
  samples: readonly (StrollCandidate | undefined)[],
  sampleCount: number = STROLL_CANDIDATE_SAMPLES
): Vec3 | undefined {
  let best: StrollCandidate | undefined;
  for (let i = 0; i < Math.min(samples.length, sampleCount); i++) {
    const c = samples[i];
    if (!c) continue;
    if (!best || c.walkValue > best.walkValue) best = c;
  }
  return best?.point;
}

/**
 * 朝向偏置选点（转身/扭头带动下次游走方向）：以概率 bias 从当前偏航 ±spread
 * 内采样，其余全向随机；距离 [minDist, max(minDist, radius)] 均匀。
 * MCBE 朝向向量 (-sin yaw, 0, cos yaw)。
 */
export function pickDirectionalStrollPoint(
  center: Vec3,
  yawDeg: number,
  radius: number = STROLL_DEFAULT_RADIUS,
  rng: () => number = Math.random,
  bias = 0.6,
  spreadDeg = 60,
  minDist = 0
): Vec3 {
  const angleDeg = rng() < bias ? yawDeg + (rng() * 2 - 1) * spreadDeg : rng() * 360;
  const rad = (angleDeg * Math.PI) / 180;
  const hi = Math.max(minDist, radius); // radius<minDist（异常配置）→ 固定 minDist
  const dist = minDist + Math.floor(rng() * (hi - minDist + 1));
  return {
    x: Math.floor(center.x) + 0.5 + -Math.sin(rad) * dist,
    y: center.y,
    z: Math.floor(center.z) + 0.5 + Math.cos(rad) * dist,
  };
}

/** 路线生成选项（点数上下限/范围/随机源） */
export interface StrollRouteOptions {
  radius?: number;
  minDist?: number;
  pointMin?: number;
  pointMax?: number;
  rng?: () => number;
}

/**
 * 随机游走路线生成：0~3 点，水平全落起点为圆心 radius 圆内，且每点相对前一点
 * 水平距离 ≤ STROLL_ROUTE_STEP_MAX（导航直达上限 16 留余量，越圆点收回圆沿）；
 * y 保留起点（地面修正归 engine）；0 点=本次保持不动。第 1 点六成朝转身方向
 * （yaw±60）；后续点以前一点相对起点方向 ±60 顺延（不折返）。
 */
export function generateStrollRoute(center: Vec3, yawDeg: number, options: StrollRouteOptions = {}): Vec3[] {
  const radius = options.radius ?? STROLL_DEFAULT_ROUTE_RADIUS;
  const minDist = options.minDist ?? STROLL_MIN_DISTANCE;
  const pointMin = options.pointMin ?? 0;
  const pointMax = options.pointMax ?? 3;
  const rng = options.rng ?? Math.random;
  const count = pointMin + Math.floor(rng() * (pointMax - pointMin + 1));

  const hi = Math.max(minDist, radius); // radius<minDist（异常配置）→ 第 1 点固定 minDist
  const stepHi = Math.max(minDist, STROLL_ROUTE_STEP_MAX);
  const points: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    let angleDeg: number;
    if (i === 0) {
      angleDeg = rng() < 0.6 ? yawDeg + (rng() * 2 - 1) * 60 : rng() * 360;
    } else {
      // 前一点相对起点的方向（MCBE yaw 反推 atan2(-dx, dz)）±60 顺延
      const prev = points[i - 1]!;
      const baseYaw = (Math.atan2(-(prev.x - center.x), prev.z - center.z) * 180) / Math.PI;
      angleDeg = rng() < 0.7 ? baseYaw + (rng() * 2 - 1) * 60 : rng() * 360;
    }
    const rad = (angleDeg * Math.PI) / 180;
    const origin = i === 0 ? center : points[i - 1]!;
    const maxDist = i === 0 ? hi : stepHi;
    const dist = minDist + Math.floor(rng() * (maxDist - minDist + 1));
    let x = origin.x + -Math.sin(rad) * dist;
    let z = origin.z + Math.cos(rad) * dist;
    // 超出圆的点沿其与圆心的连线收回圆沿：保水平距圆心 ≤radius，相邻段距仍小于导航上限 16
    const dx = x - center.x;
    const dz = z - center.z;
    const dc = Math.hypot(dx, dz);
    if (radius > 0 && dc > radius) {
      const k = radius / dc;
      x = center.x + dx * k;
      z = center.z + dz * k;
    }
    points.push({ x, y: center.y, z });
  }
  return points;
}

/** 角度规范化到 (-180, 180]（转身走最短弧） */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * 随机转头目标 yaw：概率 smallChance 在当前朝向基础上 ±spread 小幅扭动，
 * 否则大幅随机转头；转身分步平滑由 engine 负责。
 */
export function pickLookTargetYaw(
  baseYawDeg: number,
  smallChance: number,
  smallSpread: number,
  rng: () => number = Math.random
): number {
  if (rng() < smallChance) return baseYawDeg + (rng() * 2 - 1) * smallSpread;
  return rng() * 360;
}

/** 区间随机整数 [min, max]（游走/休息计数用，rng 注入可测） */
export function randomBetween(min: number, max: number, rng: () => number = Math.random): number {
  return min + Math.floor(rng() * (max - min + 1));
}
