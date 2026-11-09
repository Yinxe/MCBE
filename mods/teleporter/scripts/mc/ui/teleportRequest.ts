// ─── 待处理传送请求界面 ─────────────────────────────────────────

import type { Player } from "@minecraft/server";
import { ActionFormBuilder } from "@mc-toolchain/mod-common";
import {
  acceptTeleportRequest,
  denyTeleportRequest,
  describeRequest,
  getPendingRequest,
} from "../requests";
import { showMainMenu } from "./menu";

/**
 * 展示待处理请求。
 *
 * @returns 有请求并已弹出界面时返回 true;没有请求返回 false,调用方继续走主菜单
 */
export async function showPendingRequest(player: Player): Promise<boolean> {
  const request = getPendingRequest(player.id);
  if (!request) return false;

  await new ActionFormBuilder()
    .title("§l传送请求")
    .body(`§f来自: ${describeRequest(request)}\n§7（60秒超时）`)
    .button("§a✓ 接受", () => {
      acceptTeleportRequest(player, request);
    })
    .button("§c✗ 拒绝", () => denyTeleportRequest(player, request))
    .button("§c← 稍后处理", () => showMainMenu(player))
    .show(player);

  return true;
}
