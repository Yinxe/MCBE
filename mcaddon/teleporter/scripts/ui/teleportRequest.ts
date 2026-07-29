import { Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit/ui";
import { findPendingRequest, acceptRequest, denyRequest } from "../commands/tpa";

// ─── TPA 请求 UI ──────────────────────────────────────────────────

/**
 * 显示当前玩家的待处理传送请求。
 * 如果没有请求则返回 false，调用方可跳转到主菜单。
 */
export function showPendingRequest(player: Player): boolean {
  const request = findPendingRequest(player.id);
  if (!request) return false;

  const isTpa = request.type === "tpa";
  const desc = isTpa
    ? `§e${request.fromName} §a请求传送到你身边`
    : `§e${request.fromName} §a请求你传送到他身边`;

  new ActionFormBuilder()
    .title("§l传送请求")
    .body(
      `§f来自: §e${request.fromName}\n` +
      `§f类型: ${isTpa ? "§a请求传送过来" : "§b请求传送过去"}\n` +
      `§7（60秒超时）`,
    )
    .button("§a✓ 接受", () => {
      acceptRequest(player, request);
    })
    .button("§c✗ 拒绝", () => {
      denyRequest(player, request);
    })
    .show(player);

  return true;
}
