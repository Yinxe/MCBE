// ─── 统计页：按类型 / 按物品 双视图（Table 渲染） ─────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import type { Warehouse } from "../../core/model/Warehouse";
import { getChineseName } from "../../core/data/ItemNameMap";
import { Table } from "./Table";

/** 满仓预警阈值（容量占用比） */
export const CAPACITY_WARNING_THRESHOLD = 0.9;

export async function showStatsUI(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const stats = deps.stats.getWarehouseStats(warehouse);
  const form = new ActionFormBuilder()
    .title(`§2统计 · ${warehouse.displayName}`)
    .body(
      [
        `§7容器 §f${stats.containerCount} §7| §7槽位 §f${stats.usedSlots}/${stats.totalSlots} §7| §7物品 §f${stats.totalItems} §7| §7种类 §f${stats.uniqueTypes}`,
      ].join("\n")
    )
    .button("§f按类型查看", () => void showByType(player, deps, warehouse))
    .button("§f按物品查看", () => void showByItem(player, deps, warehouse));
  await form.show(player);
}

function showByType(player: Player, deps: CommandDeps, warehouse: Warehouse): void {
  const stats = deps.stats.getWarehouseStats(warehouse);
  const table = new Table().header("物品", "数量");
  for (const [typeId, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
    table.row(getChineseName(typeId), String(count));
  }
  player.sendMessage(`§2按类型统计（${warehouse.displayName}）\n${table.render() || "空"}`);
}

function showByItem(player: Player, deps: CommandDeps, warehouse: Warehouse): void {
  const stats = deps.stats.getWarehouseStats(warehouse);
  const table = new Table().header("物品", "数量", "堆叠", "所在容器");
  for (const [typeId, itemStat] of Object.entries(stats.byItem)) {
    const warning = itemStat.count >= 0 && itemStat.containerIds.length > 0 ? "" : "";
    void warning;
    table.row(getChineseName(typeId), String(itemStat.count), String(itemStat.stacks), itemStat.containerIds.join("、"));
  }
  player.sendMessage(`§2按物品统计（${warehouse.displayName}）\n${table.render() || "空"}`);
}

export function isCapacityWarning(used: number, capacity: number): boolean {
  return capacity > 0 && used / capacity >= CAPACITY_WARNING_THRESHOLD;
}