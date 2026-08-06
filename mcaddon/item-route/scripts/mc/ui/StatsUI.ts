// ─── 统计页：单一物品视图（物品名/数量/所在容器，按数量排序 + 单位化数量） ──
// 需求对齐：只保留"按物品统计"**单一视图**（"按类型"与"按物品"本是同一信息，去除冗余）。
// 每行展示：物品中文名 | 单位化数量（234 / 4k / 123k / 999k / 1M / 2.3M） | 所在容器
// （多容器只显示 1 个容器短 id + "和其他 n 个容器"），按数量降序。
import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import type { Warehouse } from "../../core/model/Warehouse";
import { getChineseName } from "../../core/data/ItemNameMap";
import { formatCount } from "../../core/utils/formatCount";
import { Table, Cell } from "./Table";
import * as uiColor from "./uiColor";

/** 容器 ID → 可读短名（取坐标段，如 c@(1,2,3)@overworld → (1,2,3)） */
function shortId(cid: string): string {
  return cid.split("@")[1] ?? cid;
}

/**
 * 展示仓库统计菜单：总览 + 单一"查看物品统计"入口。统计是容器内容的派生，
 * 故先 ensureContainersLoaded（仓库可能未激活）。
 *
 * @param player    - 打开统计的玩家
 * @param deps      - 命令共享依赖门面
 * @param warehouse - 目标仓库
 */
export async function showStatsUI(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  deps.ensureContainersLoaded(warehouse); // 仓库可能未激活 → 容器按需加载（统计是容器内容的派生）
  const stats = deps.stats.getWarehouseStats(warehouse);
  // 按钮文字深色（ActionForm 浅灰按钮背景）
  const form = new ActionFormBuilder()
    .title(`${uiColor.form.title}统计 · ${warehouse.displayName}`)
    .body(
      `${uiColor.form.muted}容器 ${uiColor.form.body}${stats.containerCount} ${uiColor.form.muted}| 槽位 ${uiColor.form.body}${stats.usedSlots}/${stats.totalSlots} ${uiColor.form.muted}| 物品 ${uiColor.form.body}${formatCount(stats.totalItems)} ${uiColor.form.muted}| 种类 ${uiColor.form.body}${stats.uniqueTypes}`
    )
    .button(`${uiColor.btn.nav}查看物品统计`, () => void showItemStats(player, deps, warehouse));
  await form.show(player);
}

/** 单一物品统计视图：物品名/单位化数量/所在容器（按数量降序） */
function showItemStats(player: Player, deps: CommandDeps, warehouse: Warehouse): void {
  const stats = deps.stats.getWarehouseStats(warehouse);
  const table = new Table().header(Cell.left("物品"), Cell.right("数量"), Cell.left("所在容器"));
  const rows = Object.entries(stats.byItem).sort((a, b) => b[1].count - a[1].count);
  for (const [typeId, itemStat] of rows) {
    const first = itemStat.containerIds[0] !== undefined ? shortId(itemStat.containerIds[0]) : "—";
    const more =
      itemStat.containerIds.length > 1 ? ` ${uiColor.chat.muted}和其他 ${itemStat.containerIds.length - 1} 个容器` : "";
    table.row(getChineseName(typeId), Cell.right(formatCount(itemStat.count)), `${first}${more}`);
  }
  player.sendMessage(`${uiColor.chat.warn}物品统计（${warehouse.displayName}）\n${table.render(1, [1, 2]) || "空"}`);
}
