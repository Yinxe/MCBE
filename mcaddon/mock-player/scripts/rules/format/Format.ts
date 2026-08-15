// ─── 文本格式化（core 层） ──────────────────────────────
// 纯文本格式化（不带 § 色码；带色渲染在 mc 层完成）。

const DIM_MAP: Record<string, string> = {
  "minecraft:overworld": "主世界",
  "minecraft:nether": "下界",
  "minecraft:the_end": "末地",
};

/** 维度 ID → 中文显示名（未知维度原样返回） */
export function formatDimensionId(dimId: string): string {
  return DIM_MAP[dimId] ?? dimId;
}

/** 将数字等级转为罗马数字表示（1→I, 5→V, 10→X，>10 用 [n]） */
export function levelToRoman(level: number): string {
  const map: Record<number, string> = {
    1: "I", 2: "II", 3: "III", 4: "IV", 5: "V",
    6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X",
  };
  return map[level] || `[${level}]`;
}
