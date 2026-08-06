// ─── 数量单位化格式化（纯函数，零依赖，可单测） ────────────
// 物品统计/总览用：234 → 234；5423 → 5.4k；123000 → 123k；999000 → 999k；2300000 → 2.3M。
// 规则：<1000 原样；<1M 按 k；≥1M 按 M；单位值整数不带小数，否则保留 1 位去尾零。

/** 数量单位化：234 → 234；5423 → 5.4k；123000 → 123k；999000 → 999k；2300000 → 2.3M */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return trimUnit(n / 1000) + "k";
  return trimUnit(n / 1_000_000) + "M";
}

/** 单位值去尾零：整数不带小数，否则保留 1 位 */
function trimUnit(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1).replace(/\.0$/, "");
}
