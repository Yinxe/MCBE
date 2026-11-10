// ─── 共享点池（domain 纯结构） ──────────────────────────────────
// 稀缺目标的多假人分配：claim 独占取走、release 带结论、连续失败满阈值进黑名单、
// 可用点低于水位线触发重扫。扫描动作在 engine，本模块只管分配（进程内存活，全员离线即弃）。

/** 池点位泛型约束：必须有稳定键 */
export interface PoolPoint {
  key: string;
}

/** 归还结论 */
export type ReleaseVerdict = "ok" | "spent" | "blocked";

/** 重扫水位线：可用点低于该值触发 */
export const DEFAULT_REFILL_THRESHOLD = 3;

/** 连续失败达到该次数即列入黑名单 */
export const DEFAULT_FAIL_BLACKLIST = 3;

/** 空闲队列容量上限：无界堆积会让逐点复核成本随池深膨胀、陈旧远点永远清不出去 */
export const DEFAULT_POOL_CAP = 32;

/** 单轮认领的逐点再校验预算（点）：每点≈5 探块+1 查询，绝不在一 tick 校验整池 */
export const DEFAULT_CLAIM_PROBES = 6;

export class SharedPool<T extends PoolPoint> {
  /** 可用点队列 */
  private readonly free: T[] = [];
  /** 已占用：owner → 点 */
  private readonly claimed = new Map<string, T>();
  /** 各点当前连续失败次数：key → 次数 */
  private readonly fails = new Map<string, number>();
  /** 失败次数已达阈值的点，不再入池也不被认领 */
  private blacklisted = new Set<string>();
  /** 池级单飞行标：同一时刻至多一个会话执行 SCAN */
  private scanToken: string | null = null;
  /** 位次比较（缺省=FIFO 轮转）：注入后入池/裁决回池按位次插位，弃点归还与复核未中仍走队尾 */
  private readonly rank?: (a: T, b: T) => number;

  constructor(
    private readonly refillThreshold = DEFAULT_REFILL_THRESHOLD,
    private readonly blacklistAt = DEFAULT_FAIL_BLACKLIST,
    private readonly cap = DEFAULT_POOL_CAP,
    rank?: (a: T, b: T) => number
  ) {
    this.rank = rank;
  }

  /** 重扫水位判定（SCAN 相位入口条件） */
  needsRefill(): boolean {
    return this.free.length < this.refillThreshold;
  }

  /** 入队：有位次比较则插到应得位次（rank(a,b)<0=a 在前），否则队尾；
   *  复核未中的点不走这里（claimWhere 一律回队尾） */
  private enqueue(point: T): void {
    if (!this.rank) {
      this.free.push(point);
      return;
    }
    const cmp = this.rank;
    const at = this.free.findIndex((q) => cmp(point, q) < 0);
    if (at < 0) this.free.push(point);
    else this.free.splice(at, 0, point);
  }

  /**
   * 抢占扫描标（单飞行：拿不到标的会话应退避重试）。
   * @param owner - 申请会话
   * @returns true=本会话负责本轮重扫
   */
  acquireScanToken(owner: string): boolean {
    if (this.scanToken && this.scanToken !== owner) return false;
    this.scanToken = owner;
    return true;
  }

  /**
   * 扫描完成后灌入新点（已拉黑的点不回收；超出容量的候选丢弃，调用方按质量排序后传入）。
   * @param points - 新点列表
   * @param by - 完成扫描的会话：只有持标会话本人交付才清除标记，迟到的交付不会误清他人新标
   * @returns 实际入池数（0=全为已知点/超容量）
   */
  refill(points: T[], by?: string): number {
    if (by === undefined || this.scanToken === null || this.scanToken === by) this.scanToken = null;
    const known = new Set([...this.free.map((p) => p.key), ...[...this.claimed.values()].map((p) => p.key)]);
    let added = 0;
    for (const p of points) {
      if (this.free.length >= this.cap) break;
      if (known.has(p.key) || this.blacklisted.has(p.key)) continue;
      this.enqueue(p);
      known.add(p.key);
      added++;
    }
    return added;
  }

  /**
   * 剪除空闲队列中命中判据的点（已占用点不受影响），用于清退陈旧点与超距点；
   * 点被剪除时它的失败次数一并清除。
   * @param drop - 剪除判据
   * @returns 被剪除的点数
   */
  pruneFree(drop: (p: T) => boolean): number {
    const kept: T[] = [];
    let dropped = 0;
    for (const p of this.free) {
      if (drop(p)) {
        dropped++;
        this.fails.delete(p.key);
      } else kept.push(p);
    }
    this.free.length = 0;
    // kept 是原队列子序列，位次仍成立（不重排）
    for (const p of kept) this.free.push(p);
    return dropped;
  }

  /**
   * 按键批量移除空闲点（认领时复核发现结构不成立，先记下，等本轮认领结束再统一移除；
   * 已占用点不受影响，由持有者自行带结论归还）。
   * @param keys - 待移除的点位键
   * @returns 实际移除数
   */
  removeKeys(keys: readonly string[]): number {
    if (keys.length === 0) return 0;
    const dead = new Set(keys);
    return this.pruneFree((p) => dead.has(p.key));
  }

  /**
   * 并入另一池（区合并语义）：空闲队列、已被占用的点、失败次数、黑名单与在途扫描标记
   * 整体搬入本池，源池弃用；不丢点、不产生同点双占、不丢单飞行扫描标。
   * @param other - 被并入的源池
   * @returns 搬入的空闲点数（在占用点不计数）
   */
  absorb(other: SharedPool<T>): number {
    const known = new Set([...this.free.map((p) => p.key), ...[...this.claimed.values()].map((p) => p.key)]);
    // 先搬占用：每 bot 一点，本池已持有该 bot 的话退回空闲队列
    for (const [owner, point] of other.claimedEntries()) {
      if (!this.claimed.has(owner)) {
        this.claimed.set(owner, point);
        this.dropFreeKey(point.key);
      } else if (!known.has(point.key) && !this.blacklisted.has(point.key) && this.free.length < this.cap) {
        this.enqueue(point);
      }
      known.add(point.key);
    }
    let moved = 0;
    for (const point of other.freeEntries()) {
      if (this.free.length >= this.cap) break;
      if (known.has(point.key) || this.blacklisted.has(point.key)) continue;
      this.enqueue(point);
      known.add(point.key);
      moved++;
    }
    for (const [key, count] of other.failEntries()) {
      const cur = this.fails.get(key);
      if (cur === undefined || count > cur) this.fails.set(key, count);
    }
    const black = other.blacklistKeys();
    if (black.length > 0) this.blacklisted = new Set([...this.blacklisted, ...black]);
    // 扫描标随池搬迁：源池持标会话的归还全部经本池寻址，不搬则单飞行失效
    if (this.scanToken === null) this.scanToken = other.scanToken;
    other.scanToken = null;
    return moved;
  }

  /** 把空闲队列中的同键点原位删掉（absorb 已按占用点搬入它时用，避免同点在池里留双份） */
  private dropFreeKey(key: string): void {
    const at = this.free.findIndex((p) => p.key === key);
    if (at >= 0) this.free.splice(at, 1);
  }

  // ── 并入用只读视图（同类私有访问，absorb 专供——不外露池内点位本体） ──

  private freeEntries(): readonly T[] {
    return this.free;
  }

  private claimedEntries(): readonly (readonly [string, T])[] {
    return [...this.claimed];
  }

  private failEntries(): readonly (readonly [string, number])[] {
    return [...this.fails];
  }

  private blacklistKeys(): readonly string[] {
    return [...this.blacklisted];
  }

  /**
   * 释放扫描标（SCAN 失败/中止）：仅持标者本人可解，非持标方 no-op——防迟到释放误清他人新标。
   */
  releaseScanToken(owner: string): void {
    if (this.scanToken === owner) this.scanToken = null;
  }

  /**
   * 扫描标兜底清扫：死标会永久挡重扫——正常路径 stop 已释放，此为下线/死亡双保险。
   * @param isActive - 占用者是否仍在场（调用方喂观测谓词，池保持纯逻辑）
   */
  sweepScanToken(isActive: (holder: string) => boolean): void {
    if (this.scanToken !== null && !isActive(this.scanToken)) this.scanToken = null;
  }

  /** 独占取点：取走即离池绑定 owner；池空返回 null（调用方进入等待/重扫） */
  claim(owner: string): T | null {
    if (this.claimed.has(owner)) return null; // 每 bot 同时只占一点（防囤）
    while (this.free.length > 0) {
      const point = this.free.shift()!;
      if (this.blacklisted.has(point.key)) continue;
      this.claimed.set(owner, point);
      return point;
    }
    return null;
  }

  /**
   * 带筛选的独占取点：逐点复核现场有效性，不合格点留在池中轮转防饿死。
   * @param accept - 点位是否对本会话可用（调用方喂观测谓词，池保持纯逻辑）
   * @param maxProbes - accept 复核预算（默认 DEFAULT_CLAIM_PROBES）：用尽未命中即返回 null，
   *   未探的点留队列下轮接着探
   * @param prefilter - 零成本前置筛（纯算术，不触世界）：不合用的点转队尾、不占复核预算，
   *   防池首一排合法远点吃光预算
   */
  claimWhere(
    owner: string,
    accept: (p: T) => boolean,
    maxProbes = DEFAULT_CLAIM_PROBES,
    prefilter?: (p: T) => boolean
  ): T | null {
    if (this.claimed.has(owner)) return null;
    let probes = 0;
    let skipped = 0;
    const total = this.free.length;
    while (skipped < total && probes < maxProbes && this.free.length > 0) {
      const point = this.free.shift()!;
      skipped++;
      if (this.blacklisted.has(point.key)) continue; // 已拉黑的点直接跳过，不占复核预算
      if (prefilter && !prefilter(point)) {
        this.free.push(point); // 前置筛未通过也回队尾（轮转语义不变）
        continue;
      }
      probes++;
      if (accept(point)) {
        this.claimed.set(owner, point);
        return point;
      }
      this.free.push(point); // 不合用回队尾（轮转扫描全池）
    }
    return null;
  }

  /**
   * 就近独占取点：空闲快照按 rankOf 升序排出候选序（池容量 ≤32，排序成本可忽略），
   * 只对前段候选做 accept 现场复核，复核未中的点回队尾轮转（与 claimWhere 同语义）；
   * cut 为几何截断（零成本、不占复核预算），拉黑点直接跳过。
   * 队列轮转序不受影响——位次只在"本次认领评选"内生效，锚点随认领者变化，
   * 所以不做位次插位。
   * @param owner - 认领会话
   * @param rankOf - 位次函数（越小越先，调用方按离作业锚点距离等纯算术给出）
   * @param accept - 现场复核（触世界判据由调用方喂）
   * @param maxProbes - 复核预算
   * @param cut - 几何截断（不成立的候选不参与评选，回队尾）
   */
  claimNearest(
    owner: string,
    rankOf: (p: T) => number,
    accept: (p: T) => boolean,
    maxProbes = DEFAULT_CLAIM_PROBES,
    cut?: (p: T) => boolean
  ): T | null {
    if (this.claimed.has(owner)) return null;
    const ranked = this.free
      .filter((p) => !this.blacklisted.has(p.key) && (cut ? cut(p) : true))
      .sort((a, b) => rankOf(a) - rankOf(b));
    const probes = Math.min(maxProbes, ranked.length);
    const failed = new Set<string>();
    for (let i = 0; i < probes; i++) {
      const point = ranked[i]!;
      if (accept(point)) {
        this.dropFreeKey(point.key);
        this.claimed.set(owner, point);
        return point;
      }
      failed.add(point.key);
    }
    // 复核未中回队尾：位次只在本次评选生效，轮转防饿死语义不变
    for (const key of failed) {
      const at = this.free.findIndex((p) => p.key === key);
      if (at >= 0) this.free.push(...this.free.splice(at, 1));
    }
    return null;
  }

  /** 可用点计数（可按接受判据过滤——水位线"有效点不足"口径，非原始池深） */
  countUsable(accept?: (p: T) => boolean): number {
    if (!accept) return this.free.length;
    let n = 0;
    for (const p of this.free) {
      if (!this.blacklisted.has(p.key) && accept(p)) n++;
    }
    return n;
  }

  /**
   * 给定键中此刻仍被池跟踪（在空闲队列或在占用中，未被拉黑也未移除）的个数。
   * 用于区分"扫描零新入池"：列若仍被跟踪，说明只是本会话短期跳过或他人正在采，资源仍在，
   * 不算枯竭；全部脱离跟踪（枯竭或已进黑名单）才是真的无以为继。
   * @param keys - 本扫描看到的列键（列点模型内每列一键，重复键只计一次）
   * @returns 仍被跟踪的列数
   */
  countTracked(keys: readonly string[]): number {
    if (keys.length === 0) return 0;
    const want = new Set(keys);
    let n = 0;
    for (const p of this.free) {
      if (want.has(p.key)) n++;
    }
    for (const p of this.claimed.values()) {
      if (want.has(p.key)) n++;
    }
    return n;
  }

  /**
   * 归还点位。
   * @param verdict - ok=放回可用；spent=消耗掉（点已不存在，彻底移除）；blocked=记一次失败，达阈值进黑名单
   */
  release(owner: string, verdict: ReleaseVerdict): void {
    const point = this.claimed.get(owner);
    if (!point) return;
    this.claimed.delete(owner);
    if (verdict === "spent") {
      this.fails.delete(point.key);
      return;
    }
    if (verdict === "ok") {
      this.fails.delete(point.key);
      if (!this.blacklisted.has(point.key)) this.free.push(point);
      return;
    }
    const count = (this.fails.get(point.key) ?? 0) + 1;
    this.fails.set(point.key, count);
    if (count >= this.blacklistAt) this.blacklisted.add(point.key);
    else this.free.push(point);
  }

  /**
   * 失败裁决第一段（钓点成功率模型）：记一次失败并解除占用；未达阈值回队尾，达阈值摘出交调用方裁决。
   * 与 release("blocked") 直接拉黑的区别：摘出=点位变可疑（排到同星级末尾）但仍在服务，结构塌了才移除。
   * @returns none=本会话无占用；retry=已回队尾（fails=当前连续失败数）；
   *   due=点位已摘出且失败计数清零——调用方必须再 settle 落定，否则该点凭空消失
   */
  strikeRelease(owner: string): { state: "none" | "retry" | "due"; point: T | null; fails: number } {
    const point = this.claimed.get(owner);
    if (!point) return { state: "none", point: null, fails: 0 };
    this.claimed.delete(owner);
    const count = (this.fails.get(point.key) ?? 0) + 1;
    if (count < this.blacklistAt) {
      this.fails.set(point.key, count);
      this.free.push(point); // 未达阈值=本轮先试别的点（队尾轮转，不按位次回插）
      return { state: "retry", point, fails: count };
    }
    this.fails.delete(point.key); // 达阈值摘出：调用方改写属性后从干净失败数重新计
    return { state: "due", point, fails: count };
  }

  /**
   * 失败裁决第二段：strikeRelease 摘出的点位落定。
   * @param verdict - keep=按调用方已就地改写的属性回池（位次随之重排）；
   *   drop=移出池（结构已不成立，失败计数一并清除）
   * @returns true=回池；false=未回池（drop / 池满 / 键已在黑名单）
   */
  settle(point: T, verdict: "keep" | "drop"): boolean {
    this.fails.delete(point.key);
    if (verdict === "drop") return false;
    if (this.free.length >= this.cap || this.blacklisted.has(point.key)) return false;
    this.enqueue(point);
    return true;
  }

  /** 放弃占用并拉黑当前点：不回可用队列，其他会话也就认领不到它 */
  ban(owner: string): void {
    const point = this.claimed.get(owner);
    if (!point) return;
    this.claimed.delete(owner);
    this.fails.delete(point.key);
    this.blacklisted.add(point.key);
  }

  /**
   * 解除黑名单：黑名单只代表"当时够不着"，不代表该点已不存在；
   * 而拉黑之后 refill 不会再收它，不清除就永远不会回池。
   * @returns 实际解除的键数
   */
  pardonKeys(keys: readonly string[]): number {
    let n = 0;
    for (const k of keys) {
      if (this.blacklisted.delete(k)) {
        this.fails.delete(k);
        n++;
      }
    }
    return n;
  }

  /**
   * 占用中记一次失败：不解除占用，未达阈值就同点重试，达阈值则拉黑并解除占用给别人让路。
   * @returns kept=仍持有（同点重试）；banned=已达阈值并解除占用；none=无占用
   */
  noteFail(owner: string): "none" | "kept" | "banned" {
    const point = this.claimed.get(owner);
    if (!point) return "none";
    const count = (this.fails.get(point.key) ?? 0) + 1;
    if (count >= this.blacklistAt) {
      this.ban(owner);
      return "banned";
    }
    this.fails.set(point.key, count);
    return "kept";
  }

  /** 钓获成功后清零该点失败次数，同一钓点可以接着用 */
  resetFail(owner: string): void {
    const point = this.claimed.get(owner);
    if (point) this.fails.delete(point.key);
  }

  /** 会话销毁时强制回池（防点位被死会话囤占） */
  forceRelease(owner: string): void {
    this.release(owner, "ok");
  }

  /** 本 owner 名下是否有占用（认领闸门的判据，诊断用） */
  hasClaim(owner: string): boolean {
    return this.claimed.has(owner);
  }

  /**
   * 死占用兜底清扫：此刻不再持有本池点位的占用收回空闲队列（纯内存回收，让空区能消散）。
   * 正常路径 stop 已归还，此处幂等兜底；sweepScanToken 清的是扫描标，此处清的是点位。
   * @param isLive - 占用者此刻是否仍持有本池点位（调用方喂观测谓词，池保持纯逻辑）
   * @returns 收回的占用点数
   */
  sweepClaims(isLive: (owner: string) => boolean): number {
    let freed = 0;
    for (const owner of [...this.claimed.keys()]) {
      if (isLive(owner)) continue;
      this.release(owner, "ok");
      freed++;
    }
    return freed;
  }

  /** 诊断快照（管理面板） */
  stats(): { free: number; claimed: number; blacklisted: number } {
    return { free: this.free.length, claimed: this.claimed.size, blacklisted: this.blacklisted.size };
  }

  /** 空闲队列的键列表（顺序即轮转顺序，供诊断与测试断言用，不暴露点位本体） */
  freeKeys(): string[] {
    return this.free.map((p) => p.key);
  }
}
