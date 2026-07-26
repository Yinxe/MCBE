import { Player, world, Vector3 } from "@minecraft/server";

/**
 * 将玩家传送到指定位置。
 * 调用方自行发送提示消息，本函数只负责传送。
 *
 * @param player - 要传送的玩家
 * @param location - 目标坐标
 * @param dimensionId - 目标维度 ID（如 "minecraft:overworld"）
 * @returns 是否传送成功
 */
export function teleportPlayerTo(
  player: Player,
  location: Vector3,
  dimensionId: string,
): boolean {
  try {
    const dimension = world.getDimension(dimensionId);
    player.teleport(location, { dimension });
    return true;
  } catch (e: any) {
    return false;
  }
}

/**
 * 格式化位置信息，用于消息展示。
 * 例如: "§6主世界 §f120 64 -300"
 */
export function formatLocation(location: Vector3, dimensionId: string): string {
  return `§6${formatDimension(dimensionId)} §f${Math.floor(location.x)} ${Math.floor(location.y)} ${Math.floor(location.z)}`;
}

function formatDimension(dimId: string): string {
  switch (dimId) {
    case "minecraft:overworld": return "主世界";
    case "minecraft:nether": return "下界";
    case "minecraft:the_end": return "末地";
    default: return dimId.split(":")[1] || dimId;
  }
}
