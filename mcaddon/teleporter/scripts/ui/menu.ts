import { Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit";
import { isAdmin } from "../teleporter/adminManager";
import { showAdminConfig } from "./admin";
import { showDeathPointsList } from "./deathpoints";
import { showPlayerTeleportMenu } from "./playerTeleport";
import { showPublicWarpsList } from "./publicWarps";
import { showCreateWarpForm, showWarpManagement, showWarpSelector } from "./warps";
import { showPendingRequest } from "./teleportRequest";

/**
 * 主菜单。
 * 如果当前有未处理的 TPA 传送请求，优先展示请求 UI。
 */
export function showMainMenu(player: Player): void {
  // 优先处理待处理的传送请求
  if (showPendingRequest(player)) return;

  const admin = isAdmin(player);

  const form = new ActionFormBuilder()
    .title("§l传送系统")
    .button("§b传送", () => showWarpSelector(player))
    .button("§e管理传送点", () => showWarpManagement(player))
    .button("§a✚新建传送点", () => showCreateWarpForm(player))
    .button("§a公共传送点", () => showPublicWarpsList(player))
    .button("§c死亡传送点", () => showDeathPointsList(player))
    .button("§6玩家传送", () => showPlayerTeleportMenu(player));

  if (admin) {
    form.button("§6⚙ 管理设置", () => showAdminConfig(player));
  }

  form.show(player);
}
