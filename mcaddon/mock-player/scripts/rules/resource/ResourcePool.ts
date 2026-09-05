// ─── 统一资源池模型（core 纯逻辑，零 @minecraft） ──────
// 用户拍板（2026-08-30）：共享资源的「共享/独占认领/扫描合并/失败标记」
// 这套隔离机制是钓鱼、砍树等一切资源型任务的公共底座——统一为一个泛型
// 模型 + 策略插件，**不同资源声明自己的差异规则**，杜绝各资源池平行实现
// 互相抄（避免共抢资源的语义只实现一遍）。
//
// 统一状态机（所有资源一致）：
//   free →（claim 独占认领，带 claimedAt 租约起点）→ occupied →（release）→ free
//   occupied →（markFail 连续失败达上限 / exhaust 放弃）→ unavailable（墓碑：
//     带 unavailableAt，复活期后惰性复活；merge 同 key 保留——"移除"只用于
//     资源真的没了，放弃用墓碑，防重扫复活永动机）
//   任意 →（remove 资源耗尽/消失）→ 从池移除
//
//   【设计修正 2026-09】认领有效性 ≠ 池整体 TTL：认领是"持有者生命周期"
//   的函数——读时惰性判定（租约过期 / 持有者任务已不在跑 → 视为 free），
//   不靠整池 renewing TTL 续命（长作业 chop/fish 期间不写池，旧模型会丢认领
//   导致双占）。见 PoolReadOptions.holderActive。
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
  /** 认领时刻 tick（租约起点；与 holderActive 配合判定认领是否还活着） */
  claimedAt?: number;
  /** 标记不可用时刻 tick（复活起点；复活期后惰性复活为 free） */
  unavailableAt?: number;
  /** 数据扫描时刻 tick（free 数据新鲜度起点；过期 free 不参与选点、触发重扫刷新） */
  scannedAt?: number;
}

/** 支持失败标记的条目（连续失败达上限 → unavailable；如钓鱼点） */
export interface FailCounted {
  /** 连续失败次数（成功清零；释放时达上限则标记不可用） */
  failCount: number;
}

// ─── 策略与选项 ────────────────────────────────────────

/** 距离度量（不同资源不同规则：钓鱼=水平距离，树=3D 距离） */
export type PoolDistance = (a: Vec3, b: Vec3) => number;

/** 读时判定选项（惰性降级/复活的时间与活性输入；全可选，不传 = 旧行为） */
export interface PoolReadOptions {
  /** 当前引擎 tick（租约过期/复活/新鲜度判定时钟；不传不做时间判定） */
  nowTick?: number;
  /**
   * 持有者活性判定（认领者任务是否还在跑；返回 false → 其认领视为已释放）。
   * 不传 = 只看租约时间。任务侧传入 taskManager 活性查询。
   */
  holderActive?: (claimant: string) => boolean;
  /**
   * 排除键集合（本轮已试过失败的键，如 align 失败点/现场无效树——防释放后
   * 重选回同一个坏点无限打转；成功后由调用方清空）。
   */
  excludeKeys?: Set<string> | readonly string[];
}

/** 选择约束：范围（center + maxDistance）+ 现场有效性回调（mc 层注入）+ 读时判定 */
export interface PoolPickOptions<T> extends PoolReadOptions {
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
  /**
   * 认领租期 tick（缺省不限）：occupied 条目超过 claimedAt + 此值 → 租约过期，
   * 他人读时视为 free。主防线是 holderActive（持有者任务活性）；租期是兜底
   * （管理器失联窗口）。持有者本人读自己的认领不受租期影响。
   */
  readonly claimLeaseTicks?: number;
  /**
   * 不可用复活期 tick（缺省永不复活）：unavailable 条目超过 unavailableAt +
   * 此值 → 惰性复活为 free（环境可能已恢复，如水填回/树重长）。墓碑保留在池
   * 内（merge 同 key 保留），复活前选点跳过。
   */
  readonly unavailableTtlTicks?: number;
  /**
   * free 数据新鲜期 tick（缺省不过期）：free 条目超过 scannedAt + 此值 →
   * 视为过期（选点/计数跳过，触发调用方重扫刷新；merge known 集合仍含其 key，
   * 防同一轮反复"发现新资源"）。
   */
  readonly dataTtlTicks?: number;
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
export function isUsableFor<T extends PoolEntry>(
  entry: T,
  botName: string,
  policy?: PoolPolicy<T>,
  read?: PoolReadOptions,
): boolean {
  if (entry.status === "unavailable") {
    // 墓碑复活：复活期已过 → 视为 free 可用（环境可能已恢复）
    if (policy && isResurrected(entry, policy, read?.nowTick)) return isExtraUsable(entry, botName, policy);
    return false;
  }
  if (entry.status === "occupied" && entry.claimant !== botName) {
    // 他人认领：租约过期或持有者已不活跃 → 视为已释放（可抢占）
    if (!isClaimLive(entry, policy, read)) return true;
    return false;
  }
  return isExtraUsable(entry, botName, policy);
}

/** 策略附加过滤（无策略/无过滤器 = 通过） */
function isExtraUsable<T extends PoolEntry>(entry: T, botName: string, policy?: PoolPolicy<T>): boolean {
  if (policy?.extraUsable && !policy.extraUsable(entry, botName)) return false;
  return true;
}

/**
 * 认领是否还活着（持有者本人视角恒活；他人视角看租约 + 活性）。
 * 不传 nowTick/holderActive = 旧行为（认领恒活，直到整池过期）。
 */
export function isClaimLive<T extends PoolEntry>(
  entry: PoolEntry,
  policy?: PoolPolicy<T>,
  read?: PoolReadOptions,
): boolean {
  if (entry.status !== "occupied") return false;
  // 持有者任务已不在跑 → 认领已死（崩溃/取消未清理的兜底）
  if (read?.holderActive && entry.claimant && !read.holderActive(entry.claimant)) return false;
  // 租约过期 → 死（管理器失联窗口的兜底）
  if (
    read?.nowTick !== undefined &&
    policy?.claimLeaseTicks !== undefined &&
    entry.claimedAt !== undefined &&
    read.nowTick - entry.claimedAt >= policy.claimLeaseTicks
  ) {
    return false;
  }
  return true;
}

/**
 * 墓碑是否已复活（unavailableAt + 复活期已过）。
 * 不传 nowTick / 策略无复活期 = 永不复活（旧行为）。
 */
export function isResurrected<T extends PoolEntry>(
  entry: PoolEntry,
  policy?: PoolPolicy<T>,
  nowTick?: number,
): boolean {
  return (
    entry.status === "unavailable" &&
    nowTick !== undefined &&
    policy?.unavailableTtlTicks !== undefined &&
    entry.unavailableAt !== undefined &&
    nowTick - entry.unavailableAt >= policy.unavailableTtlTicks
  );
}

/**
 * free 数据是否新鲜（过期 free 不参与选点/计数，触发调用方重扫刷新；
 * merge known 集合仍含其 key，防同一轮反复"发现新资源"）。
 * 非 free 条目恒新鲜（占用/墓碑走各自语义）；不传 nowTick / 策略无新鲜期 /
 * 无 scannedAt 时间戳 = 新鲜（旧数据兼容）。
 */
export function isEntryFresh<T extends PoolEntry>(
  entry: PoolEntry,
  policy?: PoolPolicy<T>,
  nowTick?: number,
): boolean {
  if (entry.status !== "free") return true;
  if (nowTick === undefined || policy?.dataTtlTicks === undefined || entry.scannedAt === undefined) return true;
  return nowTick - entry.scannedAt < policy.dataTtlTicks;
}

/** 条目是否通过选择约束（距离 + 现场有效性）——纯逻辑，可单测 */
export function passesPickConstraints<T extends PoolEntry>(
  entry: T,
  policy: PoolPolicy<T>,
  options?: PoolPickOptions<T>,
): boolean {
  if (!options) return true;
  // 排除键（本轮已试失败——防释放后重选回同一个坏点打转）
  if (options.excludeKeys) {
    const key = policy.keyOf(entry);
    const excluded = options.excludeKeys instanceof Set ? options.excludeKeys.has(key) : options.excludeKeys.includes(key);
    if (excluded) return false;
  }
  // free 数据过期 → 跳过（调用方会计数不足而重扫刷新）
  if (!isEntryFresh(entry, policy, options.nowTick)) return false;
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
  return pool.filter((e) => isUsableFor(e, botName, policy, options) && passesPickConstraints(e, policy, options)).length;
}

/** 挑最佳可用条目（先按状态/约束过滤，再按策略比较器取最优） */
export function pickBest<T extends PoolEntry>(
  pool: readonly T[],
  botName: string,
  policy: PoolPolicy<T>,
  botPos: Vec3,
  options?: PoolPickOptions<T>,
): T | undefined {
  const usable = pool.filter((e) => isUsableFor(e, botName, policy, options) && passesPickConstraints(e, policy, options));
  if (usable.length === 0) return undefined;
  return usable.reduce((best, cur) => (policy.compare(cur, best, botPos) < 0 ? cur : best));
}

// ─── 生命周期操作 ──────────────────────────────────────

/** 独占认领（标记共享——其他假人不再选它；写 claimedAt 租约起点） */
export function claimEntry<T extends PoolEntry>(
  pool: readonly T[],
  policy: PoolPolicy<T>,
  key: string,
  botName: string,
  nowTick?: number,
): T[] {
  return pool.map((e) =>
    policy.keyOf(e) === key ? { ...e, status: "occupied", claimant: botName, claimedAt: nowTick ?? e.claimedAt } : e,
  );
}

/**
 * 释放认领：策略支持失败标记且失败计数已达上限 → unavailable（不可用
 * 资源不复活）；否则回 free 供他人使用。
 */
export function releaseEntry<T extends PoolEntry>(
  pool: readonly T[],
  policy: PoolPolicy<T>,
  key: string,
  expectClaimant?: string,
): T[] {
  return pool.map((e) => {
    if (policy.keyOf(e) !== key) return e;
    // 占用者校验：指定期望持有者且与实际不符 → 原样返回（防误释他人认领）
    if (expectClaimant !== undefined && e.claimant !== expectClaimant) return e;
    const strikes = policy.maxFailStrikes > 0 ? readFailCount(e) : 0;
    const unavailable = policy.maxFailStrikes > 0 && strikes >= policy.maxFailStrikes;
    return { ...e, status: unavailable ? "unavailable" : "free", claimant: undefined, claimedAt: undefined };
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
  nowTick?: number,
): { pool: T[]; failCount: number; unavailable: boolean } {
  const cur = pool.find((e) => policy.keyOf(e) === key);
  const failCount = (cur?.failCount ?? 0) + 1;
  // maxFailStrikes=0 = 该资源不支持失败标记 → 永不标记不可用
  const unavailable = policy.maxFailStrikes > 0 && failCount >= policy.maxFailStrikes;
  return {
    failCount,
    unavailable,
    pool: pool.map((e) =>
      policy.keyOf(e) === key
        ? { ...e, failCount, status: unavailable ? "unavailable" : "occupied", unavailableAt: unavailable ? nowTick : e.unavailableAt }
        : e,
    ),
  };
}

/**
 * 放弃资源 → 墓碑（unavailable + unavailableAt）：资源还在世界里但本次放弃
 * （如大树顶部够不着——留顶剪枝），从"可认领"摘除但保留条目防重扫复活。
 * 复活期后惰性复活（树可能又长了/环境变化）。"移除"只用于资源真的没了。
 */
export function exhaustEntry<T extends PoolEntry>(
  pool: readonly T[],
  policy: PoolPolicy<T>,
  key: string,
  nowTick?: number,
): T[] {
  return pool.map((e) =>
    policy.keyOf(e) === key ? { ...e, status: "unavailable", claimant: undefined, claimedAt: undefined, unavailableAt: nowTick } : e,
  );
}

/** 成功一次 → 清零该条目失败计数（仍保持占用直到主动释放；同时清除不可用时间戳） */
export function resetFail<T extends PoolEntry & FailCounted>(pool: readonly T[], policy: PoolPolicy<T>, key: string): T[] {
  return pool.map((e) => (policy.keyOf(e) === key ? { ...e, failCount: 0, unavailableAt: undefined } : e));
}

/** 处理完移除（资源已耗尽/永久放弃 → 从池删除不再共享） */
export function removeEntry<T extends PoolEntry>(pool: readonly T[], policy: PoolPolicy<T>, key: string): T[] {
  return pool.filter((e) => policy.keyOf(e) !== key);
}

/** 扫描结果合并进池（去重 + 刷新）：
 * - 同 key 已占用 → 保留旧条目（持有者视图优先，不用重扫数据覆盖别人的认领）
 * - 同 key 墓碑（unavailable）→ 保留墓碑（含 unavailableAt；复活期后惰性复活）
 * - 同 key free（新鲜/过期）→ 用扫描值刷新数据（状态保持 free，打 scannedAt 时间戳）
 * - 新 key → 按 free 加入（打 scannedAt）
 */
export function mergeEntries<T extends PoolEntry>(
  pool: readonly T[],
  policy: PoolPolicy<T>,
  scanned: readonly T[],
  nowTick?: number,
): T[] {
  const byKey = new Map(pool.map((e) => [policy.keyOf(e), e]));
  for (const entry of scanned) {
    const key = policy.keyOf(entry);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, stampScanned(entry, nowTick));
    } else if (existing.status === "free") {
      // free（含过期）→ 刷新为扫描新数据（状态保持 free，时间戳更新）
      byKey.set(key, { ...stampScanned(entry, nowTick), status: "free" });
    }
    // occupied / unavailable：一律保留已有（认领视图与墓碑不受重扫影响）
  }
  return [...byKey.values()];
}

/** 给条目打扫描时间戳（无 nowTick = 原样返回，旧行为） */
function stampScanned<T extends PoolEntry>(entry: T, nowTick: number | undefined): T {
  if (nowTick === undefined) return entry;
  return { ...entry, scannedAt: nowTick };
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
