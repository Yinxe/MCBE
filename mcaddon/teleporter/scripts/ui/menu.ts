import { Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit/ui";
import { isAdmin } from "../teleporter/adminManager";
import { showWarpSelector, showWarpManagement, showCreateWarpForm } from "./warps";
import { showPublicWarpsList } from "./publicWarps";
import { showDeathPointsList } from "./deathpoints";
import { showPlayerTeleportMenu } from "./playerTeleport";
import { showAdminConfig } from "./admin";

/**
 * 主菜单。
 */
export function showMainMenu(player: Player): void {
  const admin = isAdmin(player);

  const form = new ActionFormBuilder()
    .title("§l传送管理")
    .button("§b选择传送点", () => showWarpSelector(player))
    .button("§e传送点管理", () => showWarpManagement(player))
    .button("§a✚ 新建传送点", () => showCreateWarpForm(player))
    .button("§a公共传送点", () => showPublicWarpsList(player))
    .button("§c死亡传送点", () => showDeathPointsList(player))
    .button("§6玩家传送", () => showPlayerTeleportMenu(player));

  if (admin) {
    form.button("§6⚙ 管理设置", () => showAdminConfig(player));
  }

  form.show(player);
}
