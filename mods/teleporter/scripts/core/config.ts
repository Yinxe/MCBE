// ─── 配置的键名与归一化 ─────────────────────────────────────────
//
// 「原始载荷 → 配置」的归一化是纯函数,放在这里;真正的读写由 scripts/mc/store.ts 承担。

import {
  DEFAULT_CONFIG,
  MAX_WAYPOINTS_PER_PLAYER,
  MIN_WAYPOINTS_PER_PLAYER,
  type ModConfig,
} from "./types";

/** 世界级配置的 DynamicProperty 键。沿用上游键名,老存档可直接升级。 */
export const CONFIG_KEY = "teleporter:config";

/** 把任意数字收敛到允许范围内;非有限数回落默认值。 */
export function clampWaypointLimit(value: unknown): number {
  if (typeof value !== "number" || !isFinite(value))
    return DEFAULT_CONFIG.maxWaypointsPerPlayer;
  if (value < MIN_WAYPOINTS_PER_PLAYER) return MIN_WAYPOINTS_PER_PLAYER;
  if (value > MAX_WAYPOINTS_PER_PLAYER) return MAX_WAYPOINTS_PER_PLAYER;
  return Math.floor(value);
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

  return {
    maxWaypointsPerPlayer: clampWaypointLimit(limit),
    publicWaypointEnabled:
      typeof publicEnabled === "boolean"
        ? publicEnabled
        : DEFAULT_CONFIG.publicWaypointEnabled,
  };
}
