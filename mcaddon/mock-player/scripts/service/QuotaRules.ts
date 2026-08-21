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
  return ownedCount < quota;
}

/** 剩余可创建名额（管理员返回 -1 表示无限） */
export function remainingQuota(ownedCount: number, quota: number, isAdmin: boolean): number {
  if (isAdmin) return -1;
  return Math.max(0, quota - ownedCount);
}