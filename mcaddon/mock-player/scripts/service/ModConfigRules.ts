// ─── 全局配置合并规则（core 层） ───────────────────────
// 纯逻辑：从持久化原始值解析并合并 ModConfig（损坏/缺失/部分字段回退默认）。
// McConfigStore.refresh 调用本函数，保证配置解析可脱离 mcapi 单测。

import { createDefaultConfig, MENU_TRIGGER_OPTIONS } from "../rules/Types";
import type { ModConfig } from "../rules/Types";

/**
 * 解析 DP 中存储的原始配置字符串并合并默认值。
 * @param raw world.getDynamicProperty 的原始值（undefined = 从未保存）
 * @returns 合并后的完整配置（类型损坏/缺失字段一律回退默认）
 */
export function mergeStoredConfig(raw: string | undefined): ModConfig {
  const base = createDefaultConfig();
  if (raw === undefined) return base;

  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    // 损坏 JSON → 全部回退默认
    return base;
  }
  if (saved === null || typeof saved !== "object") return base;

  const s = saved as Partial<ModConfig>;
  return {
    defaultQuota: typeof s.defaultQuota === "number" && Number.isFinite(s.defaultQuota)
      ? Math.max(0, Math.floor(s.defaultQuota))
      : base.defaultQuota,
    quotas: s.quotas !== null && typeof s.quotas === "object" && !Array.isArray(s.quotas)
      ? sanitizeQuotas(s.quotas)
      : {},
    admins: Array.isArray(s.admins)
      ? s.admins.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      : [],
    autoOnlineOnRestart: typeof s.autoOnlineOnRestart === "boolean" ? s.autoOnlineOnRestart : base.autoOnlineOnRestart,
    ownerOfflineAutoOffline: typeof s.ownerOfflineAutoOffline === "boolean" ? s.ownerOfflineAutoOffline : base.ownerOfflineAutoOffline,
    enabledWorkModes: s.enabledWorkModes !== null && typeof s.enabledWorkModes === "object" && !Array.isArray(s.enabledWorkModes)
      ? sanitizeEnabledWorkModes(s.enabledWorkModes as Record<string, unknown>)
      : {},
    menuTriggerItemId: sanitizeMenuTrigger(s.menuTriggerItemId, base.menuTriggerItemId!),
  };
}

/** 过滤非法配额：只保留 玩家名 → 非负整数 */
function sanitizeQuotas(quotas: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [name, value] of Object.entries(quotas)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[name] = Math.max(0, Math.floor(value));
    }
  }
  return result;
}

/** 过滤非法工作模式开关：只保留 string → boolean */
function sanitizeEnabledWorkModes(modes: Record<string, unknown>): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(modes)) {
    if (typeof v === "boolean") result[k] = v;
  }
  return result;
}

/** 过滤触发信物：null 表示关闭，仅允许预定义列表内的物品 ID，其余回退默认 */
function sanitizeMenuTrigger(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  if (typeof value === "string") {
    if (MENU_TRIGGER_OPTIONS.some((o) => o.itemId === value)) return value;
  }
  return fallback;
}