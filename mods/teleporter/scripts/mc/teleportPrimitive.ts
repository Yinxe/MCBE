// ─── 位移原语:只挪人,不碰相机、不发提示、不计次 ─────────────────
//
// 为什么单独成文件:传送的**执行**现在有两条路径(转场与即时),
// 而转场本身又要在横越阶段调用一次位移。若让 mc/teleport.ts 与
// mc/transition.ts 互相 import 就形成循环依赖,因此把最底层的
// 「把玩家挪到某处」抽出来,两侧都只依赖本文件。
//
// 本文件不做任何判断:目标维度不存在、玩家句柄失效等由调用方处理。

import { world, type Player, type Vector3 } from "@minecraft/server";

/**
 * 把玩家立即移到指定坐标与维度。
 *
 * @returns 成功返回 true;维度不存在或引擎拒绝时返回 false,不抛异常
 */
export function teleportImmediate(
  player: Player,
  location: Vector3,
  dimensionId?: string,
): boolean {
  try {
    if (dimensionId !== undefined && dimensionId !== player.dimension.id) {
      const dimension = world.getDimension(dimensionId);
      player.teleport(location, { dimension });
      return true;
    }
    player.teleport(location);
    return true;
  } catch {
    return false;
  }
}

/** 取玩家脚部坐标。脚本 API 的 `location` 即脚部位置。 */
export function feetOf(player: Player): Vector3 {
  return player.location;
}

/**
 * 取玩家眼睛坐标。
 *
 * 脚本 API 没有直接暴露眼睛位置,按 `位置 + 潜行修正` 推算:
 * 潜行时视高降到 1.27 格,站立时为 1.62 格。这两个值与上游
 * `LocalPlayer.getEyePosition()` 的实际取值一致。
 */
export function eyeOf(player: Player): Vector3 {
  const feet = player.location;
  const eyeHeight = player.isSneaking ? 1.27 : 1.62;
  return { x: feet.x, y: feet.y + eyeHeight, z: feet.z };
}
