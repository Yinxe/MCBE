// ─── 分片键值仓储：DP 单键 26KB 安全线 → 多分片 + hash 写后验 + 世代号 ──
// 解决的核心问题：DP **单 key 有长度上限**（~32K，设计按 UTF-16 26K 取安全线），
// 而仓库/索引/统计等逻辑值可能远超；同时 DP 单 key 写是原子的，但没有"一次写大值"。
//
// 方案（审查）：
//   · 分包——逻辑 key 的 payload JSON 切成多个 ≤26K 的独立 DP 键（`key:data:gen:i`）；
//     每个 data 键存一个 {h,v} 信封，v 为分包内容，h = FNV-1a(v) 完整性哈希。
//   · hash 写后验——写入后读回校验 h，失败重写一次；仍失败返回 false（不静默损坏）。
//   · 两种写入模式：
//       overwrite  ：固定 gen=0 覆盖写（小数据：配置/统计/索引），收缩时删多余分片。
//       generation ：每次写 gen+1，**先写新世代 → 更新 hdr → 删旧世代**。这样若在
//                    写中途崩溃，hdr 仍指向旧完整世代，读到的仍是旧数据——"新完整
//                    或旧完整，绝无半截"（防崩溃部分覆盖，孤儿清理时机=写新世代）。
// 总量无限制（随存档）；本层只管"单 key 不超限 + 数据不被破坏"。
import type { KeyValueStore } from "../../core/storage/KeyValueStore";

/** 单键信封安全线（UTF-16 长度：DP 仅单 key 有上限，总量随存档无限制） */
export const SAFE_ENVELOPE_LENGTH = 26_000;
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
interface Envelope {
  h: string;
  v: string;
}
/** 头部：单一 hdr 键指向"当前该读哪些分片"（mode/gen/count） */
interface Header {
  mode: "overwrite" | "generation";
  gen: number;
  count: number;
}

const hdrKey = (key: string): string => `${key}:hdr`;
const dataKey = (key: string, gen: number, i: number): string => `${key}:data:${gen}:${i}`;

export class ShardStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly safeLength: number = SAFE_ENVELOPE_LENGTH
  ) {}

  /**
   * 写分片集。
   * - overwrite：固定 gen=0 覆盖写（索引/统计/配置），写后验读回 hash，失败重写一次
   * - generation：写新世代 → 更 hdr → 删旧世代（孤儿清理时机）
   * 返回 false 仅表示"hash 写后验两次都失败"（损坏保护），不代表超预算（无总预算）。
   */
  write<T>(key: string, payload: T, mode: "overwrite" | "generation" = "overwrite"): boolean {
    const json = JSON.stringify(payload);
    const chunks = this.chunk(json);
    const old = this.kv.read<Header>(hdrKey(key));
    // generation 模式递增世代；overwrite 固定在 0
    const gen = mode === "generation" ? (old?.gen ?? 0) + 1 : 0;
    for (let i = 0; i < chunks.length; i++) {
      this.kv.write(dataKey(key, gen, i), this.envelope(chunks[i] as string));
    }
    // 先写 hdr（指向新世代）—— generation 场景下，此刻才"切换"到新数据
    this.kv.write(hdrKey(key), { mode, gen, count: chunks.length } satisfies Header);
    // 写后验：读回校验 hash，失败重写一次（DP 单键写原子，此步多为冗余保险）
    if (!this.verify(key, gen, chunks.length)) {
      for (let i = 0; i < chunks.length; i++) {
        this.kv.write(dataKey(key, gen, i), this.envelope(chunks[i] as string));
      }
      if (!this.verify(key, gen, chunks.length)) {
        // 两次验签仍失败：hdr 已切到坏新世代 → 还原旧 hdr，让读取回退到旧完整世代
        // （保住"新完整或旧完整，绝无半截"的崩溃安全承诺）
        if (old) this.kv.write(hdrKey(key), old);
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
