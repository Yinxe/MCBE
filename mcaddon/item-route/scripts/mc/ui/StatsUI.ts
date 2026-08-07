// ─── 统计页：**一个页面**展示仓库总计全部信息，不省略 ──
// 需求对齐：仓库总计只在**单一页面**展示——顶部汇总行（容器/槽位/物品/种类）+ 下方全量物品表
// （物品中文名 | 单位化数量，按数量降序），无分页、无省略、不显示所在容器。
// 物品数量单位化：234 / 4k / 123k / 999k / 1M / 2.3M。
import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import type { Warehouse } from "../../core/model/Warehouse";
import { getChineseName } from "../../core/data/ItemNameMap";
import { formatCount } from "../../core/utils/formatCount";
import { Table, Cell } from "./Table";
import * as uiColor from "./uiColor";

/** 展示仓库统计（单一页面：汇总 + 全量物品表）。统计是容器内容的派生，先 ensure 容器。 */
export async function showStatsUI(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  deps.ensureContainersLoaded(warehouse); // 仓库可能未激活 → 容器按需加载（统计是容器内容的派生）
  const stats = deps.stats.getWarehouseStats(warehouse);
  const table = new Table().header(Cell.left("物品"), Cell.right("数量"));
  const rows = Object.entries(stats.byItem).sort((a, b) => b[1].count - a[1].count);
  for (const [typeId, itemStat] of rows) {
    table.row(getChineseName(typeId), Cell.right(formatCount(itemStat.count)));
  }
  const body = [
    `${uiColor.form.muted}仓库 ${uiColor.form.body}${warehouse.displayName}`,
    `${uiColor.form.muted}容器 ${uiColor.form.body}${stats.containerCount} ${uiColor.form.muted}| 槽位 ${uiColor.form.body}${stats.usedSlots}/${stats.totalSlots} ${uiColor.form.muted}| 物品 ${uiColor.form.body}${formatCount(stats.totalItems)} ${uiColor.form.muted}| 种类 ${uiColor.form.body}${stats.uniqueTypes}`,
    table.render(1, [1, 2]) || `${uiColor.form.muted}（空）`,
  ].join("\n");
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}仓库总计 · ${warehouse.displayName}（${rows.length} 种）`)
    .label("stats", body);
  await form.show(player);
}