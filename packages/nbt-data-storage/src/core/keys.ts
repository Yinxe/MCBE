// ── 维度/区域 ID 约定（纯逻辑） ────────────────────────────────────
// 每个存储区域有一个唯一区域 ID（regionId）= `{维度token}:{区块X}:{区块Z}`，如 `2:0:-64`。
// 该 ID 即 DP 持久化键的后缀（`nds:item:{id}`），也是跨模组共享/取物的寻址依据：
//   `put` 成功返回 { regionId, slotId }，之后凭这个二元组即可 O(1) 取物。
//
// 维度用紧凑 token 压缩键长：三大主维度用枚举 0/1/2（覆盖全部可用维度），
// 其余（防御性，Bedrock 暂无可自定义维度）回退维度短名，可逆且无碰撞。

/** 维度短名 → 枚举（0 主世界 / 1 下界 / 2 末地） */
export const DIMENSION_ENUM = { overworld: 0, nether: 1, the_end: 2 } as const;
/** 枚举 → 维度短名（反查） */
export const DIMENSION_ENUM_NAME: Record<number, string> = { 0: "overworld", 1: "nether", 2: "the_end" };

/** 维度短名：剥掉 `minecraft:` 前缀（`minecraft:the_end` → `the_end`） */
export function shortDimension(dimensionId: string): string {
  return dimensionId.replace(/^minecraft:/, "");
}

/** 维度短名 → 紧凑 token（主维度 0/1/2，其余回退短名） */
export function dimensionToken(shortDim: string): string {
  const code = DIMENSION_ENUM[shortDim as keyof typeof DIMENSION_ENUM];
  return code !== undefined ? String(code) : shortDim;
}

/** 紧凑 token → 维度短名（可逆） */
export function dimensionFromToken(token: string): string {
  const name = DIMENSION_ENUM_NAME[Number(token)];
  return name ?? token;
}

/** 构造区域唯一 ID（同维度同区块 → 同一 ID → 共享存储） */
export function regionId(shortDim: string, chunkX: number, chunkZ: number): string {
  return `${dimensionToken(shortDim)}:${chunkX}:${chunkZ}`;
}

/** 解析区域 ID → 维度短名 + 区块坐标；非法返回 null */
export function parseRegionId(id: string): { shortDim: string; chunkX: number; chunkZ: number } | null {
  const m = /^([^:]+):(-?\d+):(-?\d+)$/.exec(id);
  if (!m) return null;
  return { shortDim: dimensionFromToken(m[1] ?? ""), chunkX: Number(m[2]), chunkZ: Number(m[3]) };
}

/** 存入成功后返回的取物凭据：区域 ID + 格子 ID，凭它 O(1) 取物 */
export interface StoredRef {
  /** 区域唯一 ID：`2:0:-64` */
  regionId: string;
  /** 格子 ID（0 起稠密编号） */
  slotId: number;
}
