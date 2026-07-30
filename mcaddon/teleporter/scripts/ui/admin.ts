import { Player } from "@minecraft/server";
import { ModalFormBuilder, notifySuccess } from "@yinxe/toolkit";
import { loadConfig, saveConfig } from "../teleporter/config";
import { showMainMenu } from "./menu";

/**
 * 管理员配置页。
 */
export function showAdminConfig(player: Player): void {
  const config = loadConfig();

  new ModalFormBuilder()
    .title("§l管理设置")
    .slider("maxWaypoints", "单人最大传送点数", 10, 100, {
      defaultValue: config.maxWaypointsPerPlayer,
      valueStep: 5,
    })
    .toggle("publicEnabled", "启用公共传送点", {
      defaultValue: config.publicWaypointEnabled,
    })
    .show(player)
    .then((vals) => {
      if (!vals) return;

      config.maxWaypointsPerPlayer = vals.maxWaypoints as number;
      config.publicWaypointEnabled = vals.publicEnabled as boolean;
      saveConfig(config);

      notifySuccess(player, "§a配置已保存");
      showMainMenu(player);
    });
}
