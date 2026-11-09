// ─── 公共传送点列表界面 ─────────────────────────────────────────

import type { Player } from "@minecraft/server";
import { ActionFormBuilder } from "@mc-toolchain/mod-common";
import {
  collectPublicWaypoints,
  incrementTeleportCount,
} from "../../core/waypoints";
import {
  loadAllPlayerData,
  loadConfig,
  loadPlayerData,
  savePlayerData,
} from "../store";
import { teleportToSavedPoint } from "../teleport";
import { showMainMenu } from "./menu";
import { pageLabel, publicWaypointSummary, slicePage } from "./shared";

const PAGE_SIZE = 8;

/** 公共传送点列表:汇总所有玩家的公开传送点,按次数降序。 */
export async function showPublicWarpsList(
  player: Player,
  page = 0,
): Promise<void> {
  const config = loadConfig();
  const waypoints = collectPublicWaypoints(
    loadAllPlayerData(),
    config.publicWaypointEnabled,
  );
  const paged = slicePage(waypoints, page, PAGE_SIZE);

  const form = new ActionFormBuilder().title(
    `§l公共传送点 (${waypoints.length})`,
  );

  if (waypoints.length === 0) {
    form.body(
      config.publicWaypointEnabled
        ? "§6暂无公共传送点"
        : "§6公共传送点功能已关闭",
    );
  } else {
    form.body(
      `§6${pageLabel(paged.currentPage, paged.totalPages)}  §e点击名称传送`,
    );
  }

  for (const waypoint of paged.items) {
    form.button(publicWaypointSummary(waypoint), async () => {
      // 先确认传送成功再计次,避免失败也涨次数
      const ok = teleportToSavedPoint(
        player,
        waypoint.name,
        waypoint.location,
        waypoint.dimensionId,
      );
      if (!ok) return;

      // 计数记在所有者名下,不在当前玩家名下
      const ownerData = loadPlayerData(waypoint.ownerId);
      incrementTeleportCount(ownerData, waypoint.id);
      savePlayerData(waypoint.ownerId, ownerData);
      await showPublicWarpsList(player);
    });
  }

  if (paged.totalPages > 1) {
    if (paged.currentPage > 0) {
      form.button("◀ 上一页", () =>
        showPublicWarpsList(player, paged.currentPage - 1),
      );
    }
    if (paged.currentPage < paged.totalPages - 1) {
      form.button("▶ 下一页", () =>
        showPublicWarpsList(player, paged.currentPage + 1),
      );
    }
  }

  form.button("§c← 返回主菜单", () => showMainMenu(player));

  await form.show(player);
}
