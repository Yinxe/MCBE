// ─── 分片键值仓储：DP 单键 26KB 安全线 → 多分片 + hash 写后验 ──
import type { KeyValueStore } from "../../core/storage/KeyValueStore";

/** 单键信封安全线（UTF-16 长度，v1 24KB 同款口径留余量） */
export const SAFE_ENVELOPE_LENGTH = 26_000;
/** DP 总配额 1MB 的保守预算（预留余量，判定用） */
export const MAX_TOTAL_BYTES = 900_000;
/** 信封 JSON 开销（{h,v} 结构 + 引号转义预留） */
const ENVELOPE_OVERHEAD = 64;

/** FNV-1a 32 位哈希（内容完整性校验，非加密用途） */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 分片信封：h = fnv1a(v)，读回时校验 */
interface Envelope { h: string; v: string; }
/** 头部：记录模式/世代/分片数（写后验 + 孤儿清理依据） */
interface Header { mode: "overwrite" | "generation"; gen: number; count: number; }

const hdrKey = (key: string): string => `${key}:hdr`;
const dataKey = (key: string, gen: number, i: number): string => `${key}:data:${gen}:${i}`;

export class ShardStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly totalBytes: () => number = () => 0,
    private readonly safeLength: number = SAFE_ENVELOPE_LENGTH
  ) {}

  /**
   * 写分片集。
   * - overwrite：固定 gen=0 覆盖写（索引/统计/配置），写后验读回 hash，失败重写一次
   * - generation：写新世代 → 更 hdr → 删旧世代（孤儿清理时机）
   * - 1MB 降级：估算超预算返回 false（调用方保留脏标记稍后重试）
   */
  write<T>(key: string, payload: T, mode: "overwrite" | "generation" = "overwrite"): boolean {
    const json = JSON.stringify(payload);
    const chunks = this.chunk(json);
    if (this.totalBytes() + json.length > MAX_TOTAL_BYTES) {
      console.warn(`[ItemRoute] DP 总量预算不足，拒绝写入 ${key}（+${json.length}B）`);
      return false;
    }
    const old = this.kv.read<Header>(hdrKey(key));
    const gen = mode === "generation" ? (old?.gen ?? 0) + 1 : 0;
    for (let i = 0; i < chunks.length; i++) {
      this.kv.write(dataKey(key, gen, i), this.envelope(chunks[i] as string));
    }
    this.kv.write(hdrKey(key), { mode, gen, count: chunks.length } satisfies Header);
    // 写后验：读回校验 hash，失败重写一次
    if (!this.verify(key, gen, chunks.length)) {
      for (let i = 0; i < chunks.length; i++) {
        this.kv.write(dataKey(key, gen, i), this.envelope(chunks[i] as string));
      }
      if (!this.verify(key, gen, chunks.length)) {
        console.warn(`[ItemRoute] 分片写后验失败：${key}`);
        return false;
      }
    }
    // 孤儿清理：generation 删旧世代；overwrite 收缩时删多余分片
    if (old) {
      if (mode === "generation" && old.gen !== gen) {
        for (let i = 0; i < old.count; i++) this.kv.remove(dataKey(key, old.gen as number, i));
      } else if (old.count > chunks.length) {
        for (let i = chunks.length; i < old.count; i++) this.kv.remove(dataKey(key, old.gen as number, i));
      }
    }
    return true;
  }

  read<T>(key: string): T | undefined {
    const header = this.kv.read<Header>(hdrKey(key));
    if (!header) return undefined;
    let json = "";
    for (let i = 0; i < header.count; i++) {
      const raw = this.kv.read<string>(dataKey(key, header.gen as number, i));
      if (typeof raw !== "string") return undefined;
      try {
        const env = JSON.parse(raw) as Envelope;
        if (env.h !== fnv1a(env.v)) return undefined;
        json += env.v;
      } catch {
        return undefined;
      }
    }
    try {
      return JSON.parse(json) as T;
    } catch {
      return undefined;
    }
  }

  remove(key: string): void {
    const header = this.kv.read<Header>(hdrKey(key));
    if (header) {
      for (let i = 0; i < header.count; i++) this.kv.remove(dataKey(key, header.gen as number, i));
    }
    this.kv.remove(hdrKey(key));
  }

  /** payload JSON 分包，每片保证信封 ≤ 安全线 */
  private chunk(json: string): string[] {
    const max = this.safeLength - ENVELOPE_OVERHEAD;
    if (json.length <= max) return [json];
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += max) {
      chunks.push(json.slice(i, i + max));
    }
    return chunks;
  }

  private envelope(v: string): string {
    return JSON.stringify({ h: fnv1a(v), v });
  }

  private verify(key: string, gen: number, count: number): boolean {
    for (let i = 0; i < count; i++) {
      const raw = this.kv.read<string>(dataKey(key, gen, i));
      if (typeof raw !== "string") return false;
      try {
        const env = JSON.parse(raw) as Envelope;
        if (env.h !== fnv1a(env.v)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
}