// ─── 共享记忆（core/ai） ─────────────────────────────
// 生物大脑的感知共享层：跨目标（能力）读写环境信息（威胁/血量/背包等）。
// 与 Blackboard 的区别：Blackboard 是单棵任务树私有状态；Memory 是大脑级
// 共享记忆（wiki 记忆行为系统的 Memory Module）——所有目标与感受器可见。

/** 共享记忆（botName 级；键值存储，跨目标共享） */
export class AiMemory {
  private store = new Map<string, unknown>();

  /** 读记忆（无该键返回 undefined） */
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /** 写记忆（覆盖） */
  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  /** 是否有该键 */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** 删除记忆 */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** 清空全部记忆（如假人下线时） */
  clear(): void {
    this.store.clear();
  }
}
