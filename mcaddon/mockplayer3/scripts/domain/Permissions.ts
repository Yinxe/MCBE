// ─── 权限与配额纯函数（domain） ──────────────────────────
// 判定入参全是键/记录/计数，不触世界；OP 事实由 engine 读好后作为 isAdmin 传入，
// 名单判定（adminKeys）在此完成。

import type { GlobalConfig } from "./Config";
import { UNLIMITED_QUOTA } from "./Config";
import type { BotRecord } from "./Record";

/** 查看者上下文（engine 层组装：键 + OP 事实） */
export interface Viewer {
  key: string;
  /** 真人 OP 等级 ≥ 管理员（engine 读取后传入） */
  isOp: boolean;
}

// ─── 角色判定 ──

/** 是否管理员（OP ∨ 配置名单） */
export function isAdmin(viewer: Viewer, config: GlobalConfig): boolean {
  return viewer.isOp || config.adminKeys.includes(viewer.key);
}

/** 可查看（列表过滤口径）：管理员 ∨ 主人 ∨ 无主假人 */
export function canView(viewer: Viewer, record: BotRecord, config: GlobalConfig): boolean {
  return isAdmin(viewer, config) || record.ownerKey === null || record.ownerKey === viewer.key;
}

/** 可管理（修改类操作必过）：管理员 ∨ 主人；无主假人仅管理员 */
export function canManage(viewer: Viewer, record: BotRecord, config: GlobalConfig): boolean {
  if (isAdmin(viewer, config)) return true;
  return record.ownerKey !== null && record.ownerKey === viewer.key;
}

// ─── 配额 ──

/** 解析某玩家的创建配额（覆盖→全局；管理员无限） */
export function createQuotaFor(viewer: Viewer, config: GlobalConfig): number {
  if (isAdmin(viewer, config)) return UNLIMITED_QUOTA;
  const override = config.quotas.perPlayer[viewer.key]?.create;
  return override ?? config.quotas.create;
}

/** 解析某玩家的在线配额 */
export function onlineQuotaFor(viewer: Viewer, config: GlobalConfig): number {
  if (isAdmin(viewer, config)) return UNLIMITED_QUOTA;
  const override = config.quotas.perPlayer[viewer.key]?.online;
  return override ?? config.quotas.online;
}

/** 剩余可创建名额（管理员/无限返回 -1 表示无限） */
export function remainingQuota(createdCount: number, quota: number, admin: boolean): number {
  if (admin) return -1;
  if (quota >= UNLIMITED_QUOTA) return -1;
  return Math.max(0, quota - createdCount);
}

/** 剩余可上线名额（管理员/无限返回 -1 表示无限） */
export function remainingOnlineQuota(onlineCount: number, quota: number, admin: boolean): number {
  if (admin) return -1;
  if (quota >= UNLIMITED_QUOTA) return -1;
  return Math.max(0, quota - onlineCount);
}

/**
 * 创建配额判定。
 * @param createdCount - 该查看者名下已创建假人总数（含离线）
 */
export function canCreate(
  viewer: Viewer,
  createdCount: number,
  config: GlobalConfig
): { ok: true } | { ok: false; reason: string } {
  const quota = createQuotaFor(viewer, config);
  if (quota >= UNLIMITED_QUOTA) return { ok: true };
  if (quota <= 0) return { ok: false, reason: "管理员未给你开放假人创建配额" };
  if (createdCount >= quota) {
    const left = remainingQuota(createdCount, quota, isAdmin(viewer, config));
    return {
      ok: false,
      reason: `创建失败：${viewer.key} 的假人配额已达上限（${quota} 个）${left >= 0 ? `，剩余 ${left} 个` : ""}`,
    };
  }
  return { ok: true };
}

/**
 * 上线时在线配额预检。
 * @param onlineCountForViewer - 该查看者名下当前在线假人数（不含本次）
 */
export function canGoOnline(
  viewer: Viewer,
  onlineCountForViewer: number,
  config: GlobalConfig
): { ok: true } | { ok: false; reason: string } {
  const quota = onlineQuotaFor(viewer, config);
  if (quota >= UNLIMITED_QUOTA) return { ok: true };
  if (quota <= 0) return { ok: false, reason: "管理员未给你开放假人同时在线配额" };
  if (onlineCountForViewer >= quota) {
    const left = remainingOnlineQuota(onlineCountForViewer, quota, isAdmin(viewer, config));
    return {
      ok: false,
      reason: `同时在线已达上限（${quota}个）${left >= 0 ? `，剩余 ${left} 个` : ""}，请先下线部分假人`,
    };
  }
  return { ok: true };
}
