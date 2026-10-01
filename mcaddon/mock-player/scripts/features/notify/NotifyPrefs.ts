// ─── 个人通知偏好（玩家级，跨会话保留） ──────────────────
// 合并自 v3 的 mp:notify 思路：每个玩家自己决定"是否接收 + 最低等级"。
// 存储：玩家动态属性（JSON）；读取时做损坏兜底。
import type { Player } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

/** 通知等级（从低到高；设置"最低等级"后，低于它的通知不发送） */
export type NotifyLevel = "debug" | "info" | "warn" | "error";

/** 等级强度（比较用） */
const LEVEL_RANK: Record<NotifyLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** 玩家通知偏好 */
export interface NotifyPref {
  /** 总开关 */
  enabled: boolean;
  /** 最低等级（只收 ≥ 该等级的通知） */
  level: NotifyLevel;
}

/** 动态属性键 */
const DP_KEY = "mockplayer:notify";
/** 默认偏好：开启 + 最低「信息」级 */
const DEFAULT_PREF: NotifyPref = { enabled: true, level: "info" };

/** 读取玩家偏好（无记录 / 损坏 → 默认） */
export function getNotifyPref(player: Player): NotifyPref {
  try {
    const raw = player.getDynamicProperty(DP_KEY);
    if (typeof raw !== "string") return { ...DEFAULT_PREF };
    const o = JSON.parse(raw) as Partial<NotifyPref>;
    const enabled = typeof o.enabled === "boolean" ? o.enabled : DEFAULT_PREF.enabled;
    const level =
      o.level === "debug" || o.level === "info" || o.level === "warn" || o.level === "error"
        ? o.level
        : DEFAULT_PREF.level;
    return { enabled, level };
  } catch {
    return { ...DEFAULT_PREF };
  }
}

/** 写入玩家偏好 */
export function setNotifyPref(player: Player, pref: NotifyPref): void {
  try {
    player.setDynamicProperty(DP_KEY, JSON.stringify(pref));
  } catch {
    // 写入失败不影响本次会话
  }
}

/** 该玩家是否应收到该等级的通知 */
export function shouldNotify(player: Player, level: NotifyLevel): boolean {
  const pref = getNotifyPref(player);
  if (!pref.enabled) return false;
  return LEVEL_RANK[level] >= LEVEL_RANK[pref.level];
}

/**
 * 统一通知入口：按玩家偏好过滤后发送。
 * @returns 是否实际发送（被过滤时为 false）
 */
export function notifyPlayer(player: Player, level: NotifyLevel, message: string): boolean {
  if (!shouldNotify(player, level)) return false;
  player.sendMessage(message);
  return true;
}

/** 等级 → 中文（界面 / 命令显示用） */
export function levelLabel(level: NotifyLevel): string {
  switch (level) {
    case "debug":
      return `${color.muted}调试`;
    case "info":
      return `${color.info}信息`;
    case "warn":
      return `${color.warn}警告`;
    case "error":
      return `${color.error}错误`;
  }
}

/** 偏好 → 一行概要文本 */
export function prefSummary(pref: NotifyPref): string {
  return pref.enabled ? `开启 · 最低：${levelLabel(pref.level)}` : `${color.muted}关闭`;
}