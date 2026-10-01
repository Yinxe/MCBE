// ─── 资源租约表（domain 纯逻辑） ───────────────────
// 视线/移动/手部/方块破坏都是可争用资源：能力必须先取租约。
// 冲突可见（返回持有者）；TTL 到期自动撤销。

/** 可争用资源类型 */
export type LeaseKind = "gaze" | "motion" | "hands" | "breaking";

/** 租约模式：HOLD=持有型（带 TTL 需续租）；AIM_ONCE=一次性瞄准（确认后自动中性化） */
export type LeaseMode = "HOLD" | "AIM_ONCE";

/** 单条租约 */
export interface Lease {
  kind: LeaseKind;
  /** 属主：能力 id 或管线步骤 id */
  owner: string;
  /** 仅 gaze 区分 HOLD/AIM_ONCE；其余资源恒 HOLD */
  mode: LeaseMode;
  /** 发放时刻（时钟 tick 数） */
  grantedAtTick: number;
  /** 有效时长（tick）；<=0 表示不过期（仅限 motion/hands 的显式长租约，慎用） */
  ttlTicks: number;
  /** breaking 细粒度：目标格坐标编码（区块内方块键） */
  payload?: string;
}

/** 申请结果：OK 或 EBUSY(持有者) */
export type AcquireResult = { ok: true } | { ok: false; holder: Lease };

/** gaze HOLD 默认期限（能力必须续租） */
export const GAZE_HOLD_TTL_TICKS = 200;
/** motion/hands 默认期限（导航/连续动作能力按预算申请并续租） */
export const ACTION_HOLD_TTL_TICKS = 100;

/** breaking 资源的目标格键（细粒度到格：两假人同格互斥、异格并行） */
export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * 会话租约表：breaking 按目标格细粒度共存，其余资源一类一格（独占）。
 * 生命周期挂 Session；releaseAll 由管线显式调用以触发 engine 侧注视中性化。
 */
export class LeaseTable {
  private readonly exclusive = new Map<Exclude<LeaseKind, "breaking">, Lease>();
  private readonly breaking = new Map<string, Lease>();

  /**
   * 申请租约。
   * @param now - 当前时钟 tick（先做过期清理再判冲突）
   * @returns ok=已发放；EBUSY=返回当前持有者（调用方决定等待还是放弃申请）
   */
  acquire(
    kind: LeaseKind,
    owner: string,
    mode: LeaseMode,
    now: number,
    ttlTicks: number,
    payload?: string
  ): AcquireResult {
    this.expire(now);
    if (kind === "breaking") {
      const key = payload ?? "";
      const holder = this.breaking.get(key);
      if (holder && holder.owner !== owner) return { ok: false, holder };
      this.breaking.set(key, { kind, owner, mode: "HOLD", grantedAtTick: now, ttlTicks, payload: key });
      return { ok: true };
    }
    const holder = this.exclusive.get(kind);
    if (holder && holder.owner !== owner) return { ok: false, holder };
    this.exclusive.set(kind, { kind, owner, mode, grantedAtTick: now, ttlTicks });
    return { ok: true };
  }

  /** 续租（心跳式；非属主续租视为编程错误返回 false） */
  renew(kind: LeaseKind, owner: string, now: number, ttlTicks: number, payload?: string): boolean {
    const lease = this.find(kind, owner, payload);
    if (!lease) return false;
    lease.grantedAtTick = now;
    lease.ttlTicks = ttlTicks;
    return true;
  }

  /** 释放（属主匹配才生效，幂等） */
  release(kind: LeaseKind, owner: string, payload?: string): boolean {
    const lease = this.find(kind, owner, payload);
    if (!lease) return false;
    if (kind === "breaking") this.breaking.delete(lease.payload ?? "");
    else this.exclusive.delete(kind);
    return true;
  }

  /** AIM_ONCE 执行确认后的自动中性化降级（调用方不能持有它当常驻视线） */
  confirmAimOnce(owner: string): boolean {
    const lease = this.exclusive.get("gaze");
    if (lease && lease.owner === owner && lease.mode === "AIM_ONCE") {
      this.exclusive.delete("gaze");
      return true;
    }
    return false;
  }

  /** 当前持有者查询（冲突诊断/审计） */
  holderOf(kind: LeaseKind, payload?: string): Lease | undefined {
    return kind === "breaking" ? this.breaking.get(payload ?? "") : this.exclusive.get(kind);
  }

  /** 全量快照（测试/管理面板诊断） */
  list(): Lease[] {
    return [...this.exclusive.values(), ...this.breaking.values()];
  }

  /** 撤销某属主全部租约（能力切换）；返回被撤清单供 engine 执行中性化动作 */
  releaseBy(owner: string): Lease[] {
    const removed: Lease[] = [];
    for (const [kind, lease] of [...this.exclusive]) {
      if (lease.owner === owner) {
        this.exclusive.delete(kind);
        removed.push(lease);
      }
    }
    for (const [key, lease] of [...this.breaking]) {
      if (lease.owner === owner) {
        this.breaking.delete(key);
        removed.push(lease);
      }
    }
    return removed;
  }

  /** 会话销毁：全撤并返回被撤清单 */
  releaseAll(): Lease[] {
    const all = this.list();
    this.exclusive.clear();
    this.breaking.clear();
    return all;
  }

  /** TTL 到期撤销；返回过期清单（调度器每 tick 调用，engine 侧对 gaze 过期执行中性化） */
  expire(now: number): Lease[] {
    const expired: Lease[] = [];
    for (const [kind, lease] of [...this.exclusive]) {
      if (lease.ttlTicks > 0 && now - lease.grantedAtTick >= lease.ttlTicks) {
        this.exclusive.delete(kind);
        expired.push(lease);
      }
    }
    for (const [key, lease] of [...this.breaking]) {
      if (lease.ttlTicks > 0 && now - lease.grantedAtTick >= lease.ttlTicks) {
        this.breaking.delete(key);
        expired.push(lease);
      }
    }
    return expired;
  }

  /** 表空（会话销毁后验收断言用） */
  isEmpty(): boolean {
    return this.exclusive.size === 0 && this.breaking.size === 0;
  }

  // ─── 私有 ──

  private find(kind: LeaseKind, owner: string, payload?: string): Lease | undefined {
    const lease = kind === "breaking" ? this.breaking.get(payload ?? "") : this.exclusive.get(kind);
    return lease && lease.owner === owner ? lease : undefined;
  }
}
