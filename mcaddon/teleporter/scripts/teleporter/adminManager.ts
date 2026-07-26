import { Player, world } from "@minecraft/server";
import { canManage } from "@yinxe/toolkit/player";

/**
 * 判断玩家是否为传送模组管理员。
 * 满足任一条件即为管理员：
 * 1. 原生 OP 权限（playerPermissionLevel >= Operator）
 * 2. 玩家实体上带有 "op" 标签
 */
export function isAdmin(player: Player): boolean {
  if (canManage(player)) return true;

  try {
    const entity = world.getEntity(player.id);
    if (entity && entity.hasTag("op")) return true;
  } catch {
    // 忽略
  }

  return false;
}
