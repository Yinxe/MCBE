import { UNLIMITED_QUOTA } from "../rules/Types";

// ─── 配额规则（core 层） ───────────────────────────────
// 纯逻辑：每玩家假人创建配额判定。管理员（OP 或名单）不受配额限制。

/**
 * 判定是否允许创建假人
 * @param ownedCount 该主人名下现存假人数（含离线）
 * @param quota 该主人的配额（0 = 禁止创建）
 * @param isAdmin 是否管理员（OP 或名单内）——管理员豁免配额
 */
export function canCreateBot(ownedCount: number, quota: number, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (quota <= 0) return false;
  if (quota >= UNLIMITED_QUOTA) return true;
  return ownedCount < quota;
}

/** 剩余可创建名额（管理员返回 -1 表示无限） */
export function remainingQuota(ownedCount: number, quota: number, isAdmin: boolean): number {
  if (isAdmin) return -1;
  if (quota >= UNLIMITED_QUOTA) return -1;
  return Math.max(0, quota - ownedCount);
}

/**
 * 判定是否允许上线假人（同时在线数限制）
 * @param onlineCount 该主人名下已在线假人数
 * @param quota 该主人的同时在线配额（0=禁止，999=无限）
 * @param isAdmin 是否管理员——管理员豁免
 */
export function canOnlineBot(onlineCount: number, quota: number, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (quota <= 0) return false;
  if (quota >= UNLIMITED_QUOTA) return true;
  return onlineCount < quota;
}

/** 剩余可上线名额（管理员返回 -1 表示无限） */
export function remainingOnlineQuota(onlineCount: number, quota: number, isAdmin: boolean): number {
  if (isAdmin) return -1;
  if (quota >= UNLIMITED_QUOTA) return -1;
  return Math.max(0, quota - onlineCount);
}