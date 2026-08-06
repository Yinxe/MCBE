// ─── 直接单键 JSON 存储（不分包/不 hash/不世代） ──────────
// 当"存储最小单位已缩小到容器级"后，容器统计/配置/索引条目都是**单个小值**（远小于
// DP 单键 ~32K 上限），不再需要 ShardStore 的分包 + FNV hash + 世代号保护——直接用
// DynamicPropertyStore 单键 set/get（DP 单键写本身是原子的）即可，省去分包/hash/hdr/写后验
// 的开销，读写更快、键更少。
// 仅用于**每容器一条/每仓小 meta**；超大逻辑值（若未来出现）仍回退 ShardStore。
import type { KeyValueStore } from "../../core/storage/KeyValueStore";

/** 直接键值 API：read/write/remove 单键（无 mode，无分包） */
export interface DirectKV {
  read<T>(key: string): T | undefined;
  write<T>(key: string, value: T): void;
  remove(key: string): void;
}

/**
 * DirectStore：KeyValueStore（DynamicPropertyStore/内存版）的直接包装，
 * 与 ShardStore 同形（read/write/remove），但不分包/hash/世代——容器级小数据用。
 */
export class DirectStore implements DirectKV {
  constructor(private readonly kv: KeyValueStore) {}

  read<T>(key: string): T | undefined {
    return this.kv.read<T>(key);
  }

  write<T>(key: string, value: T): void {
    this.kv.write(key, value);
  }

  remove(key: string): void {
    this.kv.remove(key);
  }
}