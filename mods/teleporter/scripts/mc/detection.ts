// ─── 群系探测与管理员判定 ───────────────────────────────────────

import {
  Player,
  PlayerPermissionLevel,
  world,
  type Dimension,
  type Vector3,
} from "@minecraft/server";
import { biomeDisplayName } from "../core/naming";

/**
 * 检测位置所在群系的中文名。
 *
 * `Dimension.getBiome` 在区块未加载或坐标越界时会抛错,这里统一回落为 undefined,
 * 让调用方决定显示「未知」还是留空。
 */
export function detectBiomeName(
  dimension: Dimension,
  location: Vector3,
): string | undefined {
  try {
    return biomeDisplayName(dimension.getBiome(location).id);
  } catch {
    return undefined;
  }
}

/**
 * 判断玩家是否为传送模组的管理员。
 *
 * 满足任一条件即视为管理员:
 *   1. 原生权限等级 >= Operator
 *   2. 玩家实体上带有 "op" 标签(便于给非 OP 玩家临时授权)
 */
export function isAdmin(player: Player): boolean {
  try {
    if (player.playerPermissionLevel >= PlayerPermissionLevel.Operator)
      return true;
  } catch {
    // 权限等级读取失败时继续看标签
  }

  try {
    const entity = world.getEntity(player.id);
    return entity !== undefined && entity.hasTag("op");
  } catch {
    return false;
  }
}
