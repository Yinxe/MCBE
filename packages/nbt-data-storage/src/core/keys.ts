// ── 维度/区域键约定（纯逻辑） ────────────────────────────────────────
// 区域键（RegionKey）= 维度短名 + 区块坐标，如 `the_end:0:-64`。
// 该键即 DP 持久化键的后缀（`nds:item:{key}`），也是跨模组共享/管理的寻址依据。

/** 维度短名：剥掉 `minecraft:` 前缀（`minecraft:the_end` → `the_end`） */
export function shortDimension(dimensionId: string): string {
  return dimensionId.replace(/^minecraft:/, "");
}

/** 构造区域键（同一区块同维度 → 同一键 → 共享存储） */
export function regionKey(shortDim: string, chunkX: number, chunkZ: number): string {
  return `${shortDim}:${chunkX}:${chunkZ}`;
}

/** 从区域键拆回维度短名与区块坐标（queryWorld/管理用） */
export function parseRegionKey(key: string): { shortDim: string; chunkX: number; chunkZ: number } | null {
  const m = /^(.+):(-?\d+):(-?\d+)$/.exec(key);
  if (!m) return null;
  return { shortDim: m[1] ?? "", chunkX: Number(m[2]), chunkZ: Number(m[3]) };
}
