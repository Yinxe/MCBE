import { type Player } from "@minecraft/server";
import { canManage } from "@yinxe/toolkit/player";

/**
 * 判断玩家是否为 OP（管理员）。
 * 委托 @yinxe/toolkit 的 canManage 实现。
 */
export function canManageWarehouse(player: Player): boolean {
  return canManage(player);
}

/**
 * 检查玩家是否是仓库的所有者。
 */
export function isWarehouseOwner(player: Player, ownerId: string | undefined): boolean {
  if (!ownerId) return canManage(player);
  return player.id === ownerId || canManage(player);
}
