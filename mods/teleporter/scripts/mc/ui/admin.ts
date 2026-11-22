// ─── 管理员配置界面 ─────────────────────────────────────────────

import type { Player } from "@minecraft/server";
import { ModalFormBuilder, notifySuccess } from "@mc-toolchain/mod-common";
import {
  MAX_WAYPOINTS_PER_PLAYER,
  MIN_WAYPOINTS_PER_PLAYER,
} from "../../core/types";
import { clampWaypointLimit } from "../../core/config";
import { loadConfig, saveConfig } from "../store";
import { showMainMenu } from "./menu";

/** 单人传送点上限的滑条步长。 */
const LIMIT_STEP = 5;
/** 管理设置:传送点上限与公共传送点开关。转场配置见 transitionSettings.ts。 */
export async function showAdminConfig(player: Player): Promise<void> {
  const config = loadConfig();

  const values = await new ModalFormBuilder()
    .title("§l管理设置")
    .slider(
      "maxWaypoints",
      "单人最大传送点数",
      MIN_WAYPOINTS_PER_PLAYER,
      MAX_WAYPOINTS_PER_PLAYER,
      {
        defaultValue: config.maxWaypointsPerPlayer,
        valueStep: LIMIT_STEP,
      },
    )
    .toggle("publicEnabled", "启用公共传送点", {
      defaultValue: config.publicWaypointEnabled,
    })
    .label("_hint", "§7传送转场请用主菜单的「✦ 传送转场」")
    .show(player);

  if (!values) return;

  config.maxWaypointsPerPlayer = clampWaypointLimit(values.maxWaypoints);
  config.publicWaypointEnabled = values.publicEnabled === true;
  saveConfig(config);

  notifySuccess(player, "配置已保存");
  await showMainMenu(player);
}
