// ─── 经验换算（domain 纯逻辑） ─────────────────────────────────────
// MC 升级公式（Java & Bedrock 一致）：0–15 级升一级需 2n+7 XP；16–30 级 5n−38；31+ 级 9n−158。
// totalXp 可直接经 addExperience 转移给玩家（回收经验交付）。

/** 升到 level 级所需（从 level 级再升一级）的经验 */
export function xpForNextLevel(level: number): number {
  if (level < 16) return 2 * level + 7;
  if (level < 31) return 5 * level - 38;
  return 9 * level - 158;
}

/** 从 0 级累计到 level 级所需的总经验 */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpForNextLevel(l);
  return total;
}

/**
 * 总经验 → 等级+进度（余数进 progress）。
 * @param totalXp - 累计总经验（>=0）
 */
export function levelFromTotalXp(totalXp: number): { level: number; progress: number } {
  let level = 0;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level++;
    if (level > 500) break; // 防御：异常巨值不进死循环
  }
  return { level, progress: remaining };
}
