// ─── 统一资源池模型（core 纯逻辑，零 @minecraft） ──────
// 用户拍板（2026-08-30）：共享资源的「共享/独占认领/扫描合并/失败标记」
// 这套隔离机制是钓鱼、砍树等一切资源型任务的公共底座——统一为一个泛型
// 模型 + 策略插件，**不同资源声明自己的差异规则**，杜绝各资源池平行实现
// 互相抄（避免共抢资源的语义只实现一遍）。
//
// 统一状态机（所有资源一致）：
//   free →（claim 独占认领）→ occupied →（release）→ free
//   occupied →（markFail 连续失败达上限）→ unavailable（选点跳过，不复活）
//   任意 →（remove 完成/永久放弃）→ 从池移除
//
// 资源差异经 PoolPolicy 声明（每种资源一份，见 FishingPool/TreePool）：
//   - keyOf：条目定位键（各资源字段名自定：钓鱼点 key / 树 id）
//   - centerOf / distance：距离基准（钓鱼=站立点+水平；树=基座+3D）
//   - compare：候选排序（钓鱼=星级降序→距离升序；树=距离升序）
//   - maxFailStrikes：连续失败上限（0 = 不支持失败标记，如树）
//   - extraUsable：额外可用性过滤（可选）
//
// 本模块纯函数（可 node 单测）：所有函数**不修改入参**，返回新值。

import type { Vec3 } from "../Types";

// ─── 条目基座 ──────────────────────────────────────────

/** 池资源状态：free=空闲 / occupied=被某假人独占认领 / unavailable=失败标记不可用 */
export type PoolEntryStatus = "free" | "occupied" | "unavailable";

/** 统一资源池条目基座（具体资源条目扩展它；定位键经策略 keyOf 读取） */
export interface PoolEntry {
  /** free=空闲 / occupied=被某假人独占 / unavailable=连续失败标记不可用 */
  status: PoolEntryStatus;
  /** 独占认领者的假人名（仅 occupied 时有意义） */
  claimant?: string;
}

/** 支持失败标记的条目（连续失败达上限 → unavailable；如钓鱼点） */
export interface FailCounted {
  /** 连续失败次数（成功清零；释放时达上限则标记不可用） */
  failCount: number;
}

// ─── 策略与选项 ────────────────────────────────────────

/** 距离度量（不同资源不同规则：钓鱼=水平距离，树=3D 距离） */
export type PoolDistance = (a: Vec3, b: Vec3) => number;

/** 选择约束：范围（center + maxDistance）+ 现场有效性回调（mc 层注入） */
export interface PoolPickOptions<T> {
  /** 距离过滤中心（通常为假人位置）；传入则启用距离约束 */
  center?: Vec3;
  /** 最大距离（格）；缺省用策略默认值 */
  maxDistance?: number;
  /**
   * 现场有效性判定（mc 层注入：点位半径内无实体/树仍存在等）；
   * 返回 false 视为不可用——不入选也不计入可用数。
   */
  isValid?: (entry: T) => boolean;
}

/** 资源池策略：一种资源的差异规则（统一模型中的"不同资源不同规则"） */
export interface PoolPolicy<T extends PoolEntry> {
  /** 条目定位键读取（各资源字段名自定：钓鱼点 key / 树 id） */
  keyOf(entry: T): string;
  /** 条目中心（距离过滤/排序基准） */
  centerOf(entry: T): Vec3;
  /** 距离度量 */
  readonly distance: PoolDistance;
  /** 缺省最大认领距离（格） */
  readonly maxDistance: number;
  /**
   * 候选排序比较器（可用性过滤后调用；返回 <0 的排前面）。
   * 附加规则（如星级评分优先）在此表达；距离升序为公共兜底。
   */
  compare(a: T, b: T, botPos: Vec3): number;
  /** 连续失败上限（0 = 该资源不支持失败标记——markFail/release 不改状态） */
  readonly maxFailStrikes: number;
  /** 额外可用性过滤（可选；如资源必须与假人同维度） */
  extraUsable?(entry: T, botName: string): boolean;
}

// ─── 可用性判定 ────────────────────────────────────────

/**
 * 某假人视角下该条目是否可用（状态 + 独占语义 + 策略附加过滤）。
 *   - unavailable → 不可用
 *   - occupied → 仅占用者本人可用（假人可使用自己独占的资源）
 *   - free → 可用
 */
export function isUsableFor<T extends PoolEntry>(entry: T, botName: string, policy?: PoolPolicy<T>): boolean {
  if (entry.status === "unavailable") return false;
  if (entry.status === "occupied" && entry.claimant !== botName) return false;
  if (policy?.extraUsable && !policy.extraUsable(entry, botName)) return false;
  return true;
}

/** 条目是否通过选择约束（距离 + 现场有效性）——纯逻辑，可单测 */
export function passesPickConstraints<T extends PoolEntry>(
  entry: T,
  policy: PoolPolicy<T>,
  options?: PoolPickOptions<T>,
): boolean {
  if (!options) return true;
  if (options.center) {
    const maxDistance = options.maxDistance ?? policy.maxDistance;
    if (policy.distance(policy.centerOf(entry), options.center) > maxDistance * maxDistance) return false;
  }
  if (options.isValid && !options.isValid(entry)) return false;
  return true;
}

/**
 * 池内对某假人可用的有效条目数（状态可用 + 约束全合格）；
 * 不足下限时调用方主动扫描发现新资源并合并进池共享。
 */
export function countUsable<T extends PoolEntry>(
  pool: readonly T[],
  botName: string,
  policy: PoolPolicy<T>,
  options?: PoolPickOptions<T>,
): number {
  return pool.filter((e) => isUsableFor(e, botName, policy) && passesPickConstraints(e, policy, options)).length;
}

/** 挑最佳可用条目（先按状态/约束过滤，再按策略比较器取最优） */
export function pickBest<T extends PoolEntry>(
  pool: readonly T[],
  botName: string,
  policy: PoolPolicy<T>,
  botPos: Vec3,
  options?: PoolPickOptions<T>,
): T | undefined {
  const usable = pool.filter((e) => isUsableFor(e, botName, policy) && passesPickConstraints(e, policy, options));
  if (usable.length === 0) return undefined;
  return usable.reduce((best, cur) => (policy.compare(cur, best, botPos) < 0 ? cur : best));
}

// ─── 生命周期操作 ──────────────────────────────────────

/** 独占认领（标记共享——其他假人不再选它） */
export function claimEntry<T extends PoolEntry>(pool: readonly T[], policy: PoolPolicy<T>, key: string, botName: string): T[] {
  return pool.map((e) => (policy.keyOf(e) === key ? { ...e, status: "occupied", claimant: botName } : e));
}

/**
 * 释放认领：策略支持失败标记且失败计数已达上限 → unavailable（不可用
 * 资源不复活）；否则回 free 供他人使用。
 */
export function releaseEntry<T extends PoolEntry>(pool: readonly T[], policy: PoolPolicy<T>, key: string): T[] {
  return pool.map((e) => {
    if (policy.keyOf(e) !== key) return e;
    const strikes = policy.maxFailStrikes > 0 ? readFailCount(e) : 0;
    const unavailable = policy.maxFailStrikes > 0 && strikes >= policy.maxFailStrikes;
    return { ...e, status: unavailable ? "unavailable" : "free", claimant: undefined };
  });
}

/**
 * 记一次失败（该条目）：连续失败达策略上限 → 标记不可用（并共享）。
 * 仅对支持失败标记的资源有意义（maxFailStrikes > 0）。
 * @returns 新池 + 更新后失败计数 + 是否已达不可用
 */
export function markFail<T extends PoolEntry & FailCounted>(
  pool: readonly T[],
  policy: PoolPolicy<T>,
  key: string,
): { pool: T[]; failCount: number; unavailable: boolean } {
  const cur = pool.find((e) => policy.keyOf(e) === key);
  const failCount = (cur?.failCount ?? 0) + 1;
  // maxFailStrikes=0 = 该资源不支持失败标记 → 永不标记不可用
  const unavailable = policy.maxFailStrikes > 0 && failCount >= policy.maxFailStrikes;
  return {
    failCount,
    unavailable,
    pool: pool.map((e) =>
      policy.keyOf(e) === key ? { ...e, failCount, status: unavailable ? "unavailable" : "occupied" } : e,
    ),
  };
}

/** 成功一次 → 清零该条目失败计数（仍保持占用直到主动释放） */
export function resetFail<T extends PoolEntry & FailCounted>(pool: readonly T[], policy: PoolPolicy<T>, key: string): T[] {
  return pool.map((e) => (policy.keyOf(e) === key ? { ...e, failCount: 0 } : e));
}

/** 处理完移除（资源已耗尽/永久放弃 → 从池删除不再共享） */
export function removeEntry<T extends PoolEntry>(pool: readonly T[], policy: PoolPolicy<T>, key: string): T[] {
  return pool.filter((e) => policy.keyOf(e) !== key);
}

/** 扫描结果合并进池（去重）：同 key 保留已有状态/认领/计数，新资源按 free 加入 */
export function mergeEntries<T extends PoolEntry>(pool: readonly T[], policy: PoolPolicy<T>, scanned: readonly T[]): T[] {
  const byKey = new Map(pool.map((e) => [policy.keyOf(e), e]));
  for (const entry of scanned) {
    const key = policy.keyOf(entry);
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

// ─── 距离度量（内置两种常用实现） ──────────────────────

/** 水平距离平方（忽略 Y——钓鱼点等地面资源用） */
export function horizontalDistSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** 3D 距离平方（树等立体资源用） */
export function dist3dSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// ─── 内部工具 ──────────────────────────────────────────

/** 读取失败计数（不支持失败标记的条目按 0 处理） */
function readFailCount(entry: PoolEntry): number {
  return (entry as Partial<FailCounted>).failCount ?? 0;
}
