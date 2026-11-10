// ─── 中文显示格式化（domain 纯函数） ──────────────────────────────
// 维度 ID→中文显示名；未知维度原样返回（自定义维度无中文名可接受）。

const DIM_MAP: Record<string, string> = {
  "minecraft:overworld": "主世界",
  "minecraft:nether": "下界",
  "minecraft:the_end": "末地",
};

/** 维度 ID → 中文显示名（未知维度原样返回） */
export function dimensionLabel(dimId: string): string {
  return DIM_MAP[dimId] ?? dimId;
}
