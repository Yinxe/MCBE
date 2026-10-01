// ─── 共享钓鱼点池（core 纯逻辑） ─────────────────────
// 生物 AI 自动钓鱼的跨假人共享数据模型：所有钓鱼假人共用一个池
// （存 SharedMemory "fishing:pool"，renewing TTL——活跃即延长）。
//
// 占用机制（用户规格 2026-08-18）：
//   - free  → 任何假人可选用（并独占占用 claimSpot）
//   - occupied → 被某假人独占占用（claimant），**只有占用者本人可用**
//   - unavailable → 该点连续抛竿失败 ≥ 上限（SPOT_MAX_FAIL_STRIKES=3），
//     已标记不可用并共享——选点跳过
//   - 现场**任何实体**占用（mc 层 isSpotUsable 判定）→ 不可用；假人可以
//     使用自己独占的这个点（isSpotUsableFor 的 claimant 语义）
//
// 选点约束（用户规格）：假人只能从池里选**自身 16 格内**（SPOT_MAX_DISTANCE）
// **且点位半径 1 内无其他实体**（mc 层 isValid 回调注入）的有效钓鱼点。
//
// 可用性下限（POOL_MIN_USABLE=3）：池内**有效点**（状态 + 距离 + 现场实体
// 全合格）不足时，下次寻找的假人主动扫描发现新钓鱼点并合并进池共享
// （mergeScanned）。
//
// 本模块纯函数（零 @minecraft，可单测）：所有函数**不修改入参**，返回新值。

import type { CastAim, FishingSpot } from "./FishingRules";
import type { Vec3 } from "./Types";

/** 共享钓鱼点状态 */
export type SpotStatus = "free" | "occupied" | "unavailable";

/** 共享钓鱼点条目（可序列化，存 SharedMemory） */
export interface PoolSpot {
  /** 定位键 "维度@x,y,z"（去重/定位用） */
  key: string;
  /** 所在维度（跨假人共享——维度不符不可用） */
  dimension: string;
  /** 站立格坐标 */
  stand: Vec3;
  /** 支撑方块坐标 */
  support: Vec3;
  /** 相邻水面坐标列表 */
  waters: Vec3[];
  /** 抛竿瞄准点（星级评分） */
  aim: CastAim;
  /** free=空闲 / occupied=被某假人独占 / unavailable=连续失败标记不可用 */
  status: SpotStatus;
  /** 独占占用者的假人名（仅 occupied 时有意义） */
  claimant?: string;
  /** 连续抛竿失败次数（≥ SPOT_MAX_FAIL_STRIKES → unavailable） */
  failCount: number;
}

/** 共享池键（SharedMemory） */
export const FISH_POOL_KEY = "fishing:pool";

/** 连续抛竿失败上限：≥ 3 次 → 标记该点不可用并共享（用户规格） */
export const SPOT_MAX_FAIL_STRIKES = 3;

/** 可用钓鱼点下限：池内可用数 < 此值 → 下次寻找的假人主动发现新点并共享 */
export const POOL_MIN_USABLE = 3;

/** 选点最大距离（格，用户规格：假人只能从池里选**自身 16 格内**的钓鱼点） */
export const SPOT_MAX_DISTANCE = 16;

/** 池 TTL（tick = 60 秒；renewing——数据持续被写入/更新即延长） */
export const POOL_TTL_TICKS = 1200;

/** 站立方格定位键（维度内去重/定位） */
export function spotKey(dimension: string, stand: Vec3): string {
  return `${dimension}@${Math.floor(stand.x)},${Math.floor(stand.y)},${Math.floor(stand.z)}`;
}

/** 扫描结果合并进池（去重）：同 key 保留已有状态/占用/失败计数，新点按 free 加入 */
export function mergeScanned(spots: readonly PoolSpot[], scanned: readonly FishingSpot[], dimension: string): PoolSpot[] {
  const byKey = new Map(spots.map((s) => [s.key, s]));
  for (const fs of scanned) {
    const key = spotKey(dimension, fs.stand);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        dimension,
        stand: fs.stand,
        support: fs.support,
        waters: fs.waters,
        aim: fs.aim,
        status: "free",
        failCount: 0,
      });
    }
  }
  return [...byKey.values()];
}

/**
 * 某假人视角下该点是否可用（状态 + 独占语义；现场实体占用由 mc 层叠加判定）。
 *   - unavailable → 不可用
 *   - occupied → 仅占用者本人可用（假人可使用自己独占的点）
 *   - free → 可用
 * @param dimension 假人所在维度（不一致视为不可用；不传则不过滤维度）
 */
export function isSpotUsableFor(spot: PoolSpot, botName: string, dimension?: string): boolean {
  if (dimension !== undefined && spot.dimension !== dimension) return false;
  if (spot.status === "unavailable") return false;
  if (spot.status === "occupied") return spot.claimant === botName;
  return true;
}

/**
 * 选点约束选项：距离（center + maxDistance）+ 现场有效性（isValid 回调）。
 * 距离纯数学本模块可算；现场有效性（实体占用半径 1 内无其他实体等）需 mc
 * 层注入判定——**本 core 模块保持零 @minecraft**，仅通过回调承接。
 */
export interface SpotPickOptions {
  /** 距离过滤中心（通常为假人位置）；传入则启用距离约束 */
  center?: Vec3;
  /** 最大距离（格，用户规格：假人只能选自身 16 格内的钓鱼点）；缺省 SPOT_MAX_DISTANCE */
  maxDistance?: number;
  /**
   * 现场有效性判定（mc 层注入）：点位**半径 1 内无其他实体**且点位仍构成
   * 钓鱼点才返回 true；不传则跳过现场判定（仅按池状态/距离过滤）。
   * 返回 false 的点视为不可用——不入选也不计入可用数。
   */
  isValid?: (spot: PoolSpot) => boolean;
}

/** 点位是否通过选点约束（距离 + 现场有效性）——纯逻辑，可单测 */
export function passesSpotConstraints(spot: PoolSpot, options: SpotPickOptions | undefined): boolean {
  if (!options) return true;
  if (options.center) {
    const maxDistance = options.maxDistance ?? SPOT_MAX_DISTANCE;
    if (distSq(spot.stand, options.center) > maxDistance * maxDistance) return false;
  }
  if (options.isValid && !options.isValid(spot)) return false;
  return true;
}

/**
 * 池内对某假人可用的有效点数（用户规格："有效钓鱼点" = 状态可用 +
 * 距离约束 + 现场无实体占用；不足下限 → 调用方主动扫描发现新点并共享）。
 *
 * @param dimension 假人所在维度（不传不过滤维度）
 * @param options   选点约束（center/maxDistance/isValid）；缺省仅按状态过滤
 */
export function countUsable(
  spots: readonly PoolSpot[],
  botName: string,
  dimension?: string,
  options?: SpotPickOptions,
): number {
  return spots.filter((s) => isSpotUsableFor(s, botName, dimension) && passesSpotConstraints(s, options)).length;
}

/**
 * 挑最佳有效钓鱼点（用户规格）：假人只能从池里选**自身 16 格内**（maxDistance）
 * 且**现场无实体占用**（isValid）的有效点；星级评分降序 → 距中心距离升序。
 *
 * @param dimension 假人所在维度（不传不过滤维度）
 * @param options   选点约束（center/maxDistance/isValid）；缺省仅按状态过滤
 */
export function pickBestSpot(
  spots: readonly PoolSpot[],
  botName: string,
  center: Vec3,
  dimension?: string,
  options?: SpotPickOptions,
): PoolSpot | undefined {
  const usable = spots.filter(
    (s) => isSpotUsableFor(s, botName, dimension) && passesSpotConstraints(s, options),
  );
  if (usable.length === 0) return undefined;
  usable.sort((a, b) => {
    if (a.aim.level !== b.aim.level) return b.aim.level - a.aim.level;
    return distSq(a.stand, center) - distSq(b.stand, center);
  });
  return usable[0];
}

/** 独占占用（标记共享——其他假人不再选它） */
export function claimSpot(spots: readonly PoolSpot[], key: string, botName: string): PoolSpot[] {
  return spots.map((s) => (s.key === key ? { ...s, status: "occupied", claimant: botName } : s));
}

/** 释放独占占用：失败计数已达上限 → unavailable（不可用点不复活）；否则回 free */
export function releaseSpot(spots: readonly PoolSpot[], key: string): PoolSpot[] {
  return spots.map((s) =>
    s.key === key
      ? { ...s, status: s.failCount >= SPOT_MAX_FAIL_STRIKES ? "unavailable" : "free", claimant: undefined }
      : s,
  );
}

/**
 * 记一次抛竿失败（该点）：连续失败达上限 → 标记不可用（并共享）。
 * @returns 新池 + 更新后失败计数 + 是否已达不可用
 */
export function markFailSpot(
  spots: readonly PoolSpot[],
  key: string,
): { spots: PoolSpot[]; failCount: number; unavailable: boolean } {
  const cur = spots.find((s) => s.key === key);
  const failCount = (cur?.failCount ?? 0) + 1;
  const unavailable = failCount >= SPOT_MAX_FAIL_STRIKES;
  return {
    failCount,
    unavailable,
    spots: spots.map((s) =>
      s.key === key ? { ...s, failCount, status: unavailable ? "unavailable" : "occupied" } : s,
    ),
  };
}

/** 抛竿成功（钓到鱼）→ 清零该点失败计数（仍保持占用直到主动释放） */
export function resetFailSpot(spots: readonly PoolSpot[], key: string): PoolSpot[] {
  return spots.map((s) => (s.key === key ? { ...s, failCount: 0 } : s));
}

/** 水平距离平方（选点排序用） */
function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
