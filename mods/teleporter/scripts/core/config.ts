// ─── 配置的键名与归一化 ─────────────────────────────────────────
//
// 「原始载荷 → 配置」的归一化是纯函数,放在这里;真正的读写由 scripts/mc/store.ts 承担。

import {
  DEFAULT_CONFIG,
  MAX_WAYPOINTS_PER_PLAYER,
  MIN_WAYPOINTS_PER_PLAYER,
  TRANSITION_DIMENSIONS,
  TRANSITION_STYLES,
  type ModConfig,
  type TransitionDimension,
  type TransitionStyle,
  type TransitionZoomHeightTable,
  type TransitionZoomHeights,
} from "./types";

/** 世界级配置的 DynamicProperty 键。沿用上游键名,老存档可直接升级。 */
export const CONFIG_KEY = "teleporter:config";

/** 变焦高度的允许范围(格)。下限为 1 格,上限取世界高度上限。 */
export const MIN_ZOOM_HEIGHT = 1;
export const MAX_ZOOM_HEIGHT = 320;

/** 变焦段时长的允许范围(tick)。 */
export const MIN_ZOOM_TICKS = 1;
export const MAX_ZOOM_TICKS = 200;

/** 把任意数字收敛到允许范围内;非有限数回落默认值。 */
export function clampWaypointLimit(value: unknown): number {
  if (typeof value !== "number" || !isFinite(value))
    return DEFAULT_CONFIG.maxWaypointsPerPlayer;
  if (value < MIN_WAYPOINTS_PER_PLAYER) return MIN_WAYPOINTS_PER_PLAYER;
  if (value > MAX_WAYPOINTS_PER_PLAYER) return MAX_WAYPOINTS_PER_PLAYER;
  return Math.floor(value);
}

/** 把任意数值夹取到闭区间;非有限数返回兜底值。 */
function clampNumber(
  value: unknown,
  low: number,
  high: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !isFinite(value)) return fallback;
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** 把任意数值夹取到闭区间并取整;非有限数返回兜底值。 */
function clampInteger(
  value: unknown,
  low: number,
  high: number,
  fallback: number,
): number {
  return Math.floor(clampNumber(value, low, high, fallback));
}

/**
 * 把原始风格取值归一化为合法风格。
 *
 * 缺失、非字符串、或不在三档之内的值一律回落默认值,不抛异常。
 */
export function normalizeTransitionStyle(value: unknown): TransitionStyle {
  if (typeof value !== "string") return DEFAULT_CONFIG.transitionStyle;
  return TRANSITION_STYLES.indexOf(value as TransitionStyle) === -1
    ? DEFAULT_CONFIG.transitionStyle
    : (value as TransitionStyle);
}

/**
 * 把原始总开关取值归一化为布尔值。
 *
 * 只有显式的 `false` 才关闭;缺失或类型不对都按默认(开启)处理,
 * 避免老存档因为缺字段而意外关掉转场。
 */
export function normalizeTransitionEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_CONFIG.transitionEnabled;
}

/**
 * 把原始三段高度归一化为三个合法数字。
 *
 * 必须是长度 3 的数组;任一元素非法时整组回落默认值,避免出现
 * 「第一段 20、第二段 NaN」这种半损坏状态。
 */
export function normalizeZoomHeights(value: unknown): TransitionZoomHeights {
  const defaultHeights: TransitionZoomHeights = [
    DEFAULT_CONFIG.transitionZoomHeights.overworld[0],
    DEFAULT_CONFIG.transitionZoomHeights.overworld[1],
    DEFAULT_CONFIG.transitionZoomHeights.overworld[2],
  ];

  if (!Array.isArray(value) || value.length !== 3) return defaultHeights;

  const result: TransitionZoomHeights = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    const raw = value[index];
    if (typeof raw !== "number" || !isFinite(raw)) return defaultHeights;
    result[index] = clampNumber(raw, MIN_ZOOM_HEIGHT, MAX_ZOOM_HEIGHT, 0);
  }
  return result;
}

/** 把原始段时长归一化为三个合法整数(tick)。 */
export function normalizeZoomTicks(value: unknown): TransitionZoomHeights {
  if (!Array.isArray(value) || value.length !== 3) {
    return [...DEFAULT_CONFIG.transitionZoomTicks];
  }

  const result: TransitionZoomHeights = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    const raw = value[index];
    if (typeof raw !== "number" || !isFinite(raw)) {
      return [...DEFAULT_CONFIG.transitionZoomTicks];
    }
    result[index] = clampInteger(raw, MIN_ZOOM_TICKS, MAX_ZOOM_TICKS, 0);
  }
  return result;
}

/**
 * 把原始按维度高度表归一化为合法表。
 *
 * 每个维度独立归一化:某一个维度损坏只影响它自己,其余维度照常生效。
 */
export function normalizeZoomHeightTable(
  value: unknown,
): TransitionZoomHeightTable {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;

  const result = {} as TransitionZoomHeightTable;
  for (const dimension of TRANSITION_DIMENSIONS) {
    const fallback = DEFAULT_CONFIG.transitionZoomHeights[dimension];
    const raw = source === undefined ? undefined : source[dimension];
    result[dimension as TransitionDimension] =
      raw === undefined ? [...fallback] : normalizeZoomHeights(raw);
  }
  return result;
}

/** 把原始音量归一化到 0–1。 */
export function normalizeTransitionVolume(value: unknown): number {
  return clampNumber(value, 0, 1, DEFAULT_CONFIG.transitionVolume);
}

/**
 * 把原始配置载荷归一化为合法配置。
 *
 * 缺失、损坏、字段类型不对的输入都回落默认值,不抛异常。
 */
export function normalizeConfig(raw: unknown): ModConfig {
  let source: unknown = raw;

  // 存档里存的是 JSON 字符串;也接受已经是对象的输入,便于测试与后续迁移
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  if (!source || typeof source !== "object") return { ...DEFAULT_CONFIG };

  const record = source as Record<string, unknown>;
  const limit = record.maxWaypointsPerPlayer;
  const publicEnabled = record.publicWaypointEnabled;

  const transitionEnabled = normalizeTransitionEnabled(
    record.transitionEnabled,
  );
  // 总开关关闭时把风格收敛为 off,避免出现两个真值来源
  const transitionStyle = transitionEnabled
    ? normalizeTransitionStyle(record.transitionStyle)
    : "off";

  return {
    maxWaypointsPerPlayer: clampWaypointLimit(limit),
    publicWaypointEnabled:
      typeof publicEnabled === "boolean"
        ? publicEnabled
        : DEFAULT_CONFIG.publicWaypointEnabled,
    transitionEnabled,
    transitionStyle,
    transitionZoomHeights: normalizeZoomHeightTable(
      record.transitionZoomHeights,
    ),
    transitionZoomTicks: normalizeZoomTicks(record.transitionZoomTicks),
    transitionVolume: normalizeTransitionVolume(record.transitionVolume),
  };
}
