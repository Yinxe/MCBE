// ─── 共享记忆（core/ai） ─────────────────────────────
// 跨假人共享记忆层：所有假人的生物大脑共用一个 SharedMemory 实例——
// 一个假人的能力写入、其他假人即可读取（如"某处发现威胁/资源/目标点"）。
// 与 AiMemory（botName 级、每假人独立）的区别：
//   AiMemory      = 大脑级私有记忆（同假人跨目标共享；brain.memory）
//   SharedMemory  = 群组级共享记忆（跨假人共享；引擎全局单例注入 ctx.shared）
//
// ⚠️ 过期机制（用户规格 2026-08-18）：
//   - 每键可带 TTL（tick 数）；**独立计时器每秒（20 tick）扫描**，到期的键
//     直接删除（sweepExpired）；get/has 另做惰性过期兜底
//   - 两种策略：fixed=定时过期（写入时定死到期时刻，持续更新**不延长**）；
//     renewing=延长过期（**默认**，每次写入/更新重置到期时刻——数据更新
//     即延长寿命）
//   - 内部时钟由 sweepExpired(nowTick) 推进；set 可显式传 nowTick 精确计时
//     （能力内传 ctx.tick），省略则用最近一次扫描的时钟（秒级粒度）
// ⚠️ 运行时内存，不持久化（重启/重载清空）；键用命名空间前缀防碰撞。
// 零 @minecraft 依赖，可 node 单测。

/** 过期策略：fixed=定时（写入定死到期，更新不延长）；renewing=延长（默认，更新重置到期） */
export type ExpiryStrategy = "fixed" | "renewing";

/** 共享记忆条目 */
interface SharedEntry {
  value: unknown;
  /** 策略（仅 ttl 键有意义；缺省 renewing） */
  strategy?: ExpiryStrategy;
  /** 到期 tick（>= nowTick 即过期；undefined = 永不过期） */
  expireAt?: number;
}

/** 跨假人共享记忆（键值存储 + 过期；引擎全局单例，所有假人可读可写） */
export class SharedMemory {
  private store = new Map<string, SharedEntry>();
  /** 内部时钟（tick）：由 sweepExpired 推进；set 可显式传 nowTick 覆盖 */
  private nowTick = 0;

  /** 条目是否存活（无过期 or 未到期） */
  private isLive(entry: SharedEntry): boolean {
    return entry.expireAt === undefined || this.nowTick < entry.expireAt;
  }

  /** 读共享记忆（无该键/已过期返回 undefined；惰性删除过期键） */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (!this.isLive(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /**
   * 写共享记忆（覆盖；对所有假人可见）。
   * @param ttlTicks 过期时长（tick）；undefined = 永不过期
   * @param strategy 过期策略（缺省 renewing=延长过期——每次写入/更新重置到期）
   * @param nowTick  当前引擎 tick（精确计时；省略用内部时钟——最近一次扫描的 tick）
   */
  set(key: string, value: unknown, ttlTicks?: number, strategy: ExpiryStrategy = "renewing", nowTick?: number): void {
    const existing = this.store.get(key);
    let expireAt: number | undefined;
    if (ttlTicks !== undefined && ttlTicks > 0) {
      if (strategy === "fixed" && existing?.expireAt !== undefined) {
        expireAt = existing.expireAt; // 定时过期：持续更新不延长（保持原始到期时刻）
      } else {
        expireAt = (nowTick ?? this.nowTick) + ttlTicks; // 延长过期：更新重置到期
      }
    }
    this.store.set(key, { value, strategy, expireAt });
  }

  /** 是否有该键（已过期视为不存在；惰性删除） */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (!this.isLive(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /** 删除共享记忆 */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** 清空全部共享记忆 */
  clear(): void {
    this.store.clear();
  }

  /** 当前存活键数量（已过期不计入） */
  get size(): number {
    let n = 0;
    for (const entry of this.store.values()) {
      if (entry.expireAt === undefined || this.nowTick < entry.expireAt) n++;
    }
    return n;
  }

  /**
   * 过期扫描 + 时钟推进：**每秒（20 tick）由独立计时器调用**——
   * 到期的键直接删除，返回本次删除数量。
   * @param nowTick 当前引擎 tick（推进内部时钟）
   */
  sweepExpired(nowTick?: number): number {
    if (nowTick !== undefined) this.nowTick = nowTick;
    let removed = 0;
    for (const [key, entry] of [...this.store]) {
      if (entry.expireAt !== undefined && this.nowTick >= entry.expireAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
