// ─── 主菜单与待处理请求 ─────────────────────────────────────────
//
// 有未处理的传送请求时优先弹请求界面,处理完再回主菜单。

import type { Player } from "@minecraft/server";
import { ActionFormBuilder } from "@mc-toolchain/mod-common";
import { isAdmin } from "../detection";
import { showAdminConfig } from "./admin";
import { showDeathPointsList } from "./deathPoints";
import { showPlayerTeleportMenu } from "./playerTeleport";
import { showPublicWarpsList } from "./publicWarps";
import {
  showCreateWarpForm,
  showWarpManagement,
  showWarpSelector,
} from "./warps";
import { showPendingRequest } from "./teleportRequest";

/**
 * 打开主菜单。
 *
 * 若有待处理请求,先展示请求界面并返回,玩家处理后再从该界面回到主菜单。
 */
export async function showMainMenu(player: Player): Promise<void> {
  if (await showPendingRequest(player)) return;

  const form = new ActionFormBuilder()
    .title("§l传送系统")
    .button("§b传送", () => showWarpSelector(player))
    .button("§e管理传送点", () => showWarpManagement(player))
    .button("§a✚新建传送点", () => showCreateWarpForm(player))
    .button("§a公共传送点", () => showPublicWarpsList(player))
    .button("§c死亡传送点", () => showDeathPointsList(player))
    .button("§6玩家传送", () => showPlayerTeleportMenu(player));

  if (isAdmin(player)) {
    form.button("§6⚙ 管理设置", () => showAdminConfig(player));
  }

  await form.show(player);
}
