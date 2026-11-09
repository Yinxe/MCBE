// ── 旁观配置模型:默认值 / 校验钳制 / 动态属性键(纯逻辑) ──
import type { SpConfig } from "./types";

/** 默认最大移动距离(米) */
export const DEFAULT_MAX_DISTANCE = 128;
/** 最大移动距离合法区间 */
export const MAX_DISTANCE_MIN = 5;
export const MAX_DISTANCE_MAX = 400;

/**
 * 世界动态属性键名(全局配置,持久化于世界)。
 *
 * 这里刻意沿用上游模组 `MCBE/mcaddon/spectator-mode` 的 `sp:*` 缩写键名,
 * 是本仓「命名一律用完整单词」规范的**例外**:
 *   · 旧世界的管理员配置(`sp:enabled` / `sp:maxDist` / `sp:showLink`)因此无缝延续,
 *     改键名会让已配置好的世界静默回落到默认值;
 *   · 玩家身上的灵魂锚点(`sp:soul`,见 `mc/store.ts`)同理,改键名会让
 *     「以灵魂状态离线」的存档重连后变成普通旁观者且没有逃生口。
 * 规范允许「与上游生态约定一致时保留既有缩写」,请勿把这里的 `sp:` 当作笔误修改。
 */
export const CONFIG_KEYS = {
  enabled: "sp:enabled",
  maxDistance: "sp:maxDist",
  showLink: "sp:showLink",
  /**
   * 夜视增益开关。本仓新增的键,仍沿用同一 `sp:` 前缀而非另起
   * `spectator_mode:*`:该前缀已是本模组的持久化命名空间,
   * 混用两套前缀比沿用缩写更难维护。
   */
  nightVision: "sp:nightVision",
} as const;

/** 默认配置 */
export function defaultConfig(): SpConfig {
  return { enabled: true, maxDistance: DEFAULT_MAX_DISTANCE, showLink: false, nightVision: true };
}

/**
 * 把最大距离钳制到合法区间 [MIN, MAX];非有限值回退默认。
 * @param value - 待校验的最大距离
 * @returns 合法的最大距离
 */
export function clampMaxDistance(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_DISTANCE;
  return Math.min(MAX_DISTANCE_MAX, Math.max(MAX_DISTANCE_MIN, value));
}
