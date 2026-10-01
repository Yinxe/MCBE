// ─── 坐标数字编码（domain 纯逻辑） ──────────────────────────────
// 大范围坐标集查询（getBlocks 结果集运算）共用的纯算术件。

/**
 * 坐标数字编码（Set<number> 免字符串分配）。x,y,z 各偏移 4096 后按 2^13 进制合并
 * （z 低 13 位、y 中 13 位、x 高位）；段宽不可缩——偏移后 ∈ [0,8191]，缩小会进位污染相邻段。
 */
export function coordKey(x: number, y: number, z: number): number {
  return (x + 4096) * 67108864 + (y + 4096) * 8192 + (z + 4096);
}

/** 数字 key → 坐标（诊断/归属用） */
export function keyToCoord(key: number): { x: number; y: number; z: number } {
  const z = (key % 8192) - 4096;
  const y = (Math.floor(key / 8192) % 8192) - 4096;
  const x = Math.floor(key / 67108864) - 4096;
  return { x, y, z };
}
