// ─── 经验值计算（core 层） ──────────────────────────────
// 纯逻辑：MC 经验公式（Java & Bedrock 一致）。

import type { ExperienceRecord } from "../rules/Types";

/**
 * 计算从 0 级升到 targetLevel 累计所需的总经验值（不含当前等级进度）
 * MC 升级公式：
 *   0–15 级：2n + 7
 *   16–30 级：5n - 38
 *   31+ 级：  9n - 158
 */
export function getTotalXpForLevels(targetLevel: number): number {
  let total = 0;
  for (let i = 0; i < targetLevel; i++) {
    if (i >= 30) total += 9 * i - 158;
    else if (i >= 15) total += 5 * i - 38;
    else total += 2 * i + 7;
  }
  return total;
}

/** 由等级 + 当前等级内进度组装经验记录（captureExperience 的纯数据部分） */
export function buildExperienceRecord(level: number, xpProgress: number): ExperienceRecord {
  return {
    level,
    xpProgress,
    totalXp: getTotalXpForLevels(level) + xpProgress,
  };
}
