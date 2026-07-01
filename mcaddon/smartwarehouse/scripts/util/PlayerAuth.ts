import type { Player } from "@minecraft/server";

/**
 * 判断玩家是否有权管理仓库。
 *
 * @minecraft/server 2.0.0 版本未提供 Player.isOp() API，
 * 因此在 MVP（最小可行产品）阶段，我们使用 hasTag("op") 作为管理员判断依据。
 * 仓库管理员需要在游戏中执行 /tag @s add op 命令来获取管理权限。
 *
 * 未来版本升级到支持 isOp() 的 SDK 后，应考虑迁移到官方 API。
 *
 * @param player - 待检查的玩家对象
 * @returns 如果玩家拥有 "op" 标签则返回 true，否则返回 false
 */
export function canManageWarehouse(player: Player): boolean {
  return player.hasTag("op");
}

/**
 * 检查玩家是否是仓库的所有者。
 *
 * 如果仓库没有设置 ownerId（兼容旧数据），则回退到 canManageWarehouse（OP 标签）的逻辑。
 *
 * @param player - 要检查的玩家
 * @param ownerId - 仓库所有者的玩家 ID
 * @returns 如果玩家是仓库所有者或管理员则返回 true
 */
export function isWarehouseOwner(player: Player, ownerId: string | undefined): boolean {
  if (!ownerId) return canManageWarehouse(player); // 向后兼容
  return player.id === ownerId || canManageWarehouse(player);
}
