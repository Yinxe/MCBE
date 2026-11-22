// ─── 传送执行与结果提示 ─────────────────────────────────────────
//
// 只负责「把玩家送到某处」与「告诉玩家结果」。判断该不该传送由调用方负责。
//
// 转场是**执行方式**而非附加特效:传送到同维度目标时,位移由运镜在
// 横越阶段提交,拉远与横越的这几秒同时成为落点区块的加载窗口。
// 因此本文件的对外函数改为异步——「是否成功」要等转场结束才知道。

import { world, type Player, type Vector3 } from "@minecraft/server";
import { formatLocation } from "../core/naming";
import { notifyError, notifySuccess } from "@mc-toolchain/mod-common";
import { loadConfig } from "./store";
import { playFadeTransition, playTransition } from "./transition";
import { teleportImmediate } from "./teleportPrimitive";
import { resolveTransitionMode } from "../core/transition";

// 保持既有调用方的 import 路径不变:位移原语从本模块再导出
export { teleportImmediate, feetOf, eyeOf } from "./teleportPrimitive";

/**
 * 把玩家传送到指定坐标与维度。
 *
 * 按当前配置选择执行方式:电影感运镜、黑屏淡入淡出,或即时位移。
 * 跨维度传送即使配置为电影感也会降档为淡入淡出——相机无法随玩家
 * 跨维度存续。
 *
 * @returns 成功返回 true;维度不存在或传送被引擎拒绝时返回 false,不抛异常
 */
export async function teleportPlayerTo(
  player: Player,
  location: Vector3,
  dimensionId: string,
): Promise<boolean> {
  const config = loadConfig();

  // 维度必须先确认存在,否则后面三条路径都会失败
  let targetDimensionId: string;
  try {
    targetDimensionId = world.getDimension(dimensionId).id;
  } catch {
    return false;
  }

  const target = { location, dimensionId: targetDimensionId };
  const crossDimension = player.dimension.id !== targetDimensionId;

  // 分派规则是纯函数,单独可测(见 core/transition.ts)
  const mode = resolveTransitionMode({
    style: config.transitionStyle,
    crossDimension,
  });

  if (mode === "immediate") {
    return teleportImmediate(player, location, targetDimensionId);
  }
  if (mode === "fade") {
    return playFadeTransition(player, target);
  }
  return playTransition(player, target, config);
}

/**
 * 传送到某个已保存的地点,并给出成功/失败提示。
 *
 * 提示在转场结束、位移确认之后才发出,避免「提示已到但人还在飞」。
 *
 * @param label 目标名称,用于提示文案
 */
export async function teleportToSavedPoint(
  player: Player,
  label: string,
  location: Vector3,
  dimensionId: string,
): Promise<boolean> {
  const ok = await teleportPlayerTo(player, location, dimensionId);
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
