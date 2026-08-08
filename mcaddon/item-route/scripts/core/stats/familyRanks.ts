// ─── 容器同族排行榜（纯函数，零依赖，可单测） ──
// 多物容器启用同族收纳后，配置菜单信息展示该容器内的**族榜**：
//   格式 `#1.羊毛(5|1.4k)` —— 族类型数量 | 物品总数（formatCount 单位化）
// 规则：
//   · 只统计**容器实含**的族（familyOf 命中者）——不存在的族不参与排行
//   · 按**族类型数量降序**（族内不同 itemId 种数）；同类型数时按物品总数降序（稳定可读）
//   · 不做省略、全排
import type { ContainerScanResult } from "../model/ContainerScan";
import { familyOf, getFamilyById } from "../data/item-families";
import { formatCount } from "../utils/formatCount";

/** 族榜条目：族 id / 中文名 / 族内出现的类型数 / 该族物品总数 */
export interface FamilyRank {
  familyId: string;
  displayName: string;
  typeCount: number;
  totalCount: number;
}

/**
 * 由容器扫描结果计算同族排行榜（容器中存在哪些族 → 各族类型数/总数，类型数降序）。
 * - byType 以 itemId → amount 记录；经 familyOf 归族聚合。
 * - 仅存在族参与（无族/未收录物品不参与，也不计为"未知族"）。
 * - 类型数相同时按 displayName 字序排，保证确定性（纯函数可稳定断言）。
 */
export function containerFamilyRanks(scan: ContainerScanResult): FamilyRank[] {
  const byFamily = new Map<string, { typeCount: number; totalCount: number }>();
  for (const [typeId, amount] of Object.entries(scan.byType)) {
    const fid = familyOf(typeId);
    if (fid === undefined) continue; // 无族归属（人工合成物等）不参与排行
    const entry = byFamily.get(fid);
    if (entry === undefined) byFamily.set(fid, { typeCount: 1, totalCount: amount });
    else {
      entry.typeCount += 1;
      entry.totalCount += amount;
    }
  }
  return [...byFamily.entries()]
    .map(([familyId, s]) => ({
      familyId,
      displayName: getFamilyById(familyId)?.displayName ?? familyId,
      typeCount: s.typeCount,
      totalCount: s.totalCount,
    }))
    .sort((a, b) => b.typeCount - a.typeCount || a.displayName.localeCompare(b.displayName));
}

/** 族榜单条渲染：`#1.羊毛(5|1.4k)`（首页序号从 1，全排不省略） */
export function formatFamilyRankLine(rank: FamilyRank, index: number): string {
  return `#${index}. ${rank.displayName}(${rank.typeCount}|${formatCount(rank.totalCount)})`;
}