// ─── 界面共用的展示片段 ─────────────────────────────────────────
//
// 多个屏幕都要拼「名称 + 群系 + 维度 + 坐标 + 次数」这类标签,集中在这里避免重复。

import type { WaypointRecord } from "../../core/types";
import { dimensionDisplayName, formatCoordinates } from "../../core/naming";

/** 传送点的一行摘要:置顶星标 + 名称 + 群系 + 维度坐标 + 传送次数。 */
export function waypointSummary(waypoint: WaypointRecord): string {
  const pin = waypoint.isPinned ? "★ " : "";
  const biome = waypoint.biomeInfo ? ` ${waypoint.biomeInfo}` : "";
  const location = `${dimensionDisplayName(waypoint.dimensionId)} ${formatCoordinates(waypoint.location)}`;
  return `${pin}${waypoint.name}§r${biome} §f${location} §6${waypoint.teleportCount}次`;
}

/** 公共传送点的一行摘要:额外标注所有者。 */
export function publicWaypointSummary(waypoint: WaypointRecord): string {
  const biome = waypoint.biomeInfo ? ` ${waypoint.biomeInfo}` : "";
  const location = `${dimensionDisplayName(waypoint.dimensionId)} ${formatCoordinates(waypoint.location)}`;
  return `§e${waypoint.name}§r${biome}\n§f${location} §6${waypoint.teleportCount}次 §e@${waypoint.ownerName}`;
}

/** 分页信息,例如 "第 2/3 页"。 */
export function pageLabel(currentPage: number, totalPages: number): string {
  return `第 ${currentPage + 1}/${totalPages} 页`;
}

/** 按每页条数切出一页。页码越界时自动收敛到合法范围。 */
export function slicePage<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): { items: T[]; totalPages: number; currentPage: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(0, page), totalPages - 1);
  const start = currentPage * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    totalPages,
    currentPage,
  };
}
