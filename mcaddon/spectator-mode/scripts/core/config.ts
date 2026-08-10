// ── 旁观配置模型：默认值 / 校验钳制 / 动态属性键（纯逻辑） ──
import type { SpConfig } from "./types";

/** 默认最大移动距离（米） */
export const DEFAULT_MAX_DISTANCE = 128;
/** 最大移动距离合法区间 */
export const MAX_DISTANCE_MIN = 5;
export const MAX_DISTANCE_MAX = 400;

/** 世界动态属性键名（全局配置，持久化于世界） */
export const CONFIG_KEYS = {
  enabled: "sp:enabled",
  maxDistance: "sp:maxDist",
  showLink: "sp:showLink",
} as const;

/** 默认配置 */
export function defaultConfig(): SpConfig {
  return { enabled: true, maxDistance: DEFAULT_MAX_DISTANCE, showLink: false };
}

/**
 * 把最大距离钳制到合法区间 [MIN, MAX]；非有限值回退默认。
 * @param value - 待校验的最大距离
 * @returns 合法的最大距离
 */
export function clampMaxDistance(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_DISTANCE;
  return Math.min(MAX_DISTANCE_MAX, Math.max(MAX_DISTANCE_MIN, value));
}
