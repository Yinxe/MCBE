// ─── 数量单位化格式化（纯函数，零依赖，可单测） ────────────
// 物品统计/总览用：234 → 234；5423 → 5.42k；123000 → 123k；999900 → 999.9k；2300000 → 2.3M。
// 规则：<1000 原样；<1M 按 k；≥1M 按 M；单位值保留**最多 2 位小数**（整数/尾零自动精简，如 4k/1M）。

/** 数量单位化：234 → 234；5423 → 5.42k；123000 → 123k；2300000 → 2.3M */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return trimUnit(n / 1000) + "k";
  return trimUnit(n / 1_000_000) + "M";
}

/** 单位值：保留 2 位小数并去除尾零（4.00→4、2.30→2.3、5.42 不变） */
function trimUnit(v: number): string {
  return v.toFixed(2).replace(/\.?0+$/, "");
}
