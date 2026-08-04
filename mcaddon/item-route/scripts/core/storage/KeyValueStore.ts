// ─── 键值仓储接口（core 只定义接口，DP 分片实现在 mc 层） ──
export interface KeyValueStore {
  read<T>(key: string): T | undefined;
  write<T>(key: string, value: T): void;
  remove(key: string): void;
}

/** 内存实现：单测与调试用 */
export class InMemoryKeyValueStore implements KeyValueStore {
  private map = new Map<string, unknown>();

  read<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }

  write<T>(key: string, value: T): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}
