// ─── 集群资源锁（core/ai，零 @minecraft 可单测） ────────
// 集群任务的共享资源占用机制（3.3.4，用户拍板统一规划）——
// 对齐官方 mob AI 的"共享资源占用"模式：**无中央调度器**，每个实体独立
// 选资源、跳过被占用的（蜜蜂采花 / 村民用床同理）。
// 用法：能力工作流 tryLock 选中资源（树/钓鱼点）→ 持有到完成 → unlock；
//   选资源时 othersLockedKeys 过滤；占用者失效的锁由 sweep 兜底清理
//   （正常路径工作流 finally 已释放，sweep 是下线/死亡的双保险）。
// 集群砍树 / 集群钓鱼共用此机制，未来集群行为（挖矿等）直接复用。

/** 集群资源锁（跨假人共享实例；资源键 → 占用者） */
export class ResourceLock {
  private locks = new Map<string, string>();

  /**
   * 尝试锁定资源（已被他人占用 → false，不抢占）。
   * 同 owner 重复锁定视为延续（幂等）。
   */
  tryLock(key: string, owner: string): boolean {
    const holder = this.locks.get(key);
    if (holder !== undefined && holder !== owner) return false;
    this.locks.set(key, owner);
    return true;
  }

  /** 解锁（仅占用者本人可解；他人/无锁 no-op） */
  unlock(key: string, owner: string): void {
    if (this.locks.get(key) === owner) this.locks.delete(key);
  }

  /** 资源是否被他人占用（自己占用不算） */
  isLockedByOther(key: string, owner: string): boolean {
    const holder = this.locks.get(key);
    return holder !== undefined && holder !== owner;
  }

  /** 被他人占用的键集合（选资源过滤用） */
  othersLockedKeys(owner: string): Set<string> {
    const keys = new Set<string>();
    for (const [key, holder] of this.locks) {
      if (holder !== owner) keys.add(key);
    }
    return keys;
  }

  /** 清理占用者失效的锁（下线/死亡/行为关闭——工作流定期调用兜底） */
  sweep(isActive: (owner: string) => boolean): void {
    for (const [key, holder] of [...this.locks]) {
      if (!isActive(holder)) this.locks.delete(key);
    }
  }

  /** 当前锁数量（调试/测试） */
  get size(): number {
    return this.locks.size;
  }
}
