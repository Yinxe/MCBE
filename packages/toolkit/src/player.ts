// ─── Player utilities for MCBE Script API ──────────────

import { Player, PlayerPermissionLevel } from "@minecraft/server";

/**
 * 判断玩家是否为 OP（管理员）。
 * 基于 @minecraft/server 的 PlayerPermissionLevel 枚举。
 *
 * @param player - 待检查的玩家对象
 * @returns 如果玩家的权限级别 >= Operator 则返回 true
 */
export function canManage(player: Player): boolean {
  return player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
}
