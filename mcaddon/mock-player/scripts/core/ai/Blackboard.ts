// ─── 黑板（任务共享状态） ────────────────────────────────
// 行为树节点之间通过黑板共享状态（如当前目标坐标、尝试次数）。
// 每棵行为树独立一个黑板实例（按假人隔离）。

export class Blackboard {
  private readonly store = new Map<string, unknown>();

  /** 读取键值（不存在返回 undefined） */
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /** 写入键值 */
  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  /** 是否存在键 */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** 删除键 */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** 清空全部 */
  clear(): void {
    this.store.clear();
  }
}
