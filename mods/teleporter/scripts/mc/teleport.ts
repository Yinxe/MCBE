// ─── 传送执行与结果提示 ─────────────────────────────────────────
//
// 只负责「把玩家送到某处」与「告诉玩家结果」。判断该不该传送由调用方负责。

import { world, type Player, type Vector3 } from "@minecraft/server";
import { formatLocation } from "../core/naming";
import { notifyError, notifySuccess } from "@mc-toolchain/mod-common";

/**
 * 把玩家传送到指定坐标与维度。
 *
 * @returns 成功返回 true;维度不存在或传送被引擎拒绝时返回 false,不抛异常
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
  } catch {
    return false;
  }
}

/**
 * 传送到某个已保存的地点,并给出成功/失败提示。
 *
 * @param label 目标名称,用于提示文案
 */
export function teleportToSavedPoint(
  player: Player,
  label: string,
  location: Vector3,
  dimensionId: string,
): boolean {
  const ok = teleportPlayerTo(player, location, dimensionId);
  if (ok) {
    notifySuccess(
      player,
      `已传送到 §e${label} §6（${formatLocation(location, dimensionId)}§6）`,
    );
  } else {
    notifyError(player, `传送到 §e${label}§c 失败,目标位置可能未加载`);
  }
  return ok;
}
