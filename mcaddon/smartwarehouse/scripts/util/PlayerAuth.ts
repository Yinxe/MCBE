import { PlayerPermissionLevel, type Player } from "@minecraft/server";

/**
 * 判断玩家是否为 OP（管理员）。
 *
 * 基于 @minecraft/server 提供的 PlayerPermissionLevel 枚举进行判断，
 * 不再依赖自定义的 /tag @s add op 标签系统。
 *
 * @param player - 待检查的玩家对象
 * @returns 如果玩家的权限级别 >= Operator 则返回 true
 */
export function canManageWarehouse(player: Player): boolean {
  return player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
}

/**
 * 检查玩家是否是仓库的所有者。
 *
 * 玩家必须是仓库的创建者（ownerId 匹配）或 OP 管理员。
 * 如果仓库没有设置 ownerId（兼容旧数据），则回退到 OP 检查。
 *
 * @param player - 要检查的玩家
 * @param ownerId - 仓库所有者的玩家 ID
 * @returns 如果玩家是仓库所有者或 OP 管理员则返回 true
 */
export function isWarehouseOwner(player: Player, ownerId: string | undefined): boolean {
  if (!ownerId) return canManageWarehouse(player);
  return player.id === ownerId || canManageWarehouse(player);
}
