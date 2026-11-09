// ─── 死亡点列表界面 ─────────────────────────────────────────────

import type { Player } from "@minecraft/server";
import { ActionFormBuilder } from "@mc-toolchain/mod-common";
import {
  clearDeathPoints,
  listDeathPoints,
  removeDeathPoint,
} from "../../core/deathPoints";
import {
  distanceBetween,
  dimensionDisplayName,
  formatCoordinates,
  formatTimeAgo,
} from "../../core/naming";
import type { DeathPointRecord } from "../../core/types";
import { loadPlayerData, savePlayerData } from "../store";
import { teleportToSavedPoint } from "../teleport";
import { showMainMenu } from "./menu";
import { pageLabel, slicePage } from "./shared";

const PAGE_SIZE = 8;

/** 死亡点列表:最新在前,分页展示。 */
export async function showDeathPointsList(
  player: Player,
  page = 0,
): Promise<void> {
  const data = loadPlayerData(player.id);
  const points = listDeathPoints(data);
  const paged = slicePage(points, page, PAGE_SIZE);

  const form = new ActionFormBuilder().title(`§l死亡传送点 (${points.length})`);

  if (points.length === 0) {
    form.body("§6暂无死亡记录");
  } else {
    form.body(`§6点击传送  ${pageLabel(paged.currentPage, paged.totalPages)}`);
  }

  for (const point of paged.items) {
    form.button(deathPointLabel(player, point), async () => {
      const ok = teleportToSavedPoint(
        player,
        "死亡点",
        point.location,
        point.dimensionId,
      );
      if (ok) await showDeathPointsList(player);
    });
  }

  if (paged.totalPages > 1) {
    if (paged.currentPage > 0) {
      form.button("◀ 上一页", () =>
        showDeathPointsList(player, paged.currentPage - 1),
      );
    }
    if (paged.currentPage < paged.totalPages - 1) {
      form.button("▶ 下一页", () =>
        showDeathPointsList(player, paged.currentPage + 1),
      );
    }
  }

  if (points.length > 0) {
    form.button("§c清除所有死亡点", () => {
      const fresh = loadPlayerData(player.id);
      const count = clearDeathPoints(fresh);
      savePlayerData(player.id, fresh);
      player.sendMessage(`§c已清除 ${count} 条死亡记录`);
      showDeathPointsList(player);
    });
  }

  form.button("§c← 返回主菜单", () => showMainMenu(player));

  await form.show(player);
}

/** 死亡点的一行标签:维度 + 坐标 + 相对时间,同维度时附上距离。 */
function deathPointLabel(player: Player, point: DeathPointRecord): string {
  const dimension = dimensionDisplayName(point.dimensionId);
  const coordinates = formatCoordinates(point.location);
  const timeAgo = formatTimeAgo(point.deathTime);
  const sameDimension = point.dimensionId === player.dimension.id;
  const distance = sameDimension
    ? ` §7(${distanceBetween(player.location, point.location)}格)`
    : "";
  return `§c☠ §f${dimension} ${coordinates}${distance}\n§6${timeAgo}`;
}
