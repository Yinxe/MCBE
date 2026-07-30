import { Player } from "@minecraft/server";
import { ActionFormBuilder, notifySuccess, notifyError } from "@yinxe/toolkit";
import {
  getPublicWaypoints,
  incrementTeleportCount,
} from "../teleporter/waypointManager";
import { teleportPlayerTo, formatLocation } from "../teleporter/teleportManager";
import { showMainMenu } from "./menu";

const PAGE_SIZE = 8;

/**
 * 公共传送点列表。
 */
export function showPublicWarpsList(
  player: Player,
  page: number = 0,
): void {
  const waypoints = getPublicWaypoints();
  const totalPages = Math.max(1, Math.ceil(waypoints.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageWaypoints = waypoints.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  const form = new ActionFormBuilder()
    .title(`§l公共传送点 (${waypoints.length})`);

  if (waypoints.length === 0) {
    form.body("§6暂无公共传送点");
  } else {
    form.body(`§6第 ${currentPage + 1}/${totalPages} 页  §e点击名称传送`);
  }

  for (const wp of pageWaypoints) {
    const dim = shortDimension(wp.dimensionId);
    const loc = `${Math.floor(wp.location.x)} ${Math.floor(wp.location.y)} ${Math.floor(wp.location.z)}`;
    const biome = wp.biomeInfo ? ` ${wp.biomeInfo}` : "";
    const label =
      `§e${wp.name}§r${biome}\n§f${dim} ${loc} §6${wp.teleportCount}次 §e@${wp.ownerName}`;

    form.button(label, () => {
      incrementTeleportCount(player.id, wp.id);
      const ok = teleportPlayerTo(player, wp.location, wp.dimensionId);
      if (ok) {
        notifySuccess(player, `§a已传送到 §e${wp.name}§a 的传送点`);
      } else {
        notifyError(player, `§c传送失败，§e${wp.name}§c 位置可能未加载`);
      }
    });
  }

  // 分页
  if (totalPages > 1) {
    if (currentPage > 0) {
      form.button("◀ 上一页", () => showPublicWarpsList(player, currentPage - 1));
    }
    if (currentPage < totalPages - 1) {
      form.button("▶ 下一页", () => showPublicWarpsList(player, currentPage + 1));
    }
  }

  form.button("§c← 返回主菜单", () => showMainMenu(player));

  form.show(player);
}

function shortDimension(dimId: string): string {
  switch (dimId) {
    case "minecraft:overworld": return "主世界";
    case "minecraft:nether": return "下界";
    case "minecraft:the_end": return "末地";
    default: return dimId.split(":")[1] || dimId;
  }
}
