// ─── 键值仓储接口（core 只定义接口，DP 分片实现在 mc 层） ──
// 极简字符串键值契约。core 侧只定义契约 + 内存实现供单测；
// mc 层 DynamicPropertyStore 以 world 为后端实现同一接口，
// 上层 ShardStore 再在其上加"分包 + hash 写后验 + 世代号"的可靠性层。
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
