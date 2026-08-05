// ─── ir:rescan_preview 预览重扫（member+，不写索引） ─────
import { world, system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { nameCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";
import { isSupportedContainerType } from "../../core/model/ContainerTypes";
import { Table } from "../ui/Table";
import { chat } from "../ui/uiColor";

export function registerRescanPreview(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, nameCommand("ir:rescan_preview", "预览重扫容器清单（member+）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage(`${chat.error}仓库不存在`);
      return;
    }
    if (!requireRole(deps.members, warehouse, player.id, "member")) {
      player.sendMessage(`${chat.error}需要 member 及以上权限`);
      return;
    }
    system.runTimeout(() => {
      const dim = world.getDimension(warehouse.area.dimension);
      if (dim === undefined) {
        player.sendMessage(`${chat.error}维度加载失败`);
        return;
      }
      // 收集结构化行（坐标/类型），避免在数据里混颜色码再 split 的脆弱写法
      const found: Array<{ coord: string; type: string }> = [];
      for (let y = Math.min(warehouse.area.corner1.y, warehouse.area.corner2.y); y <= Math.max(warehouse.area.corner1.y, warehouse.area.corner2.y); y++) {
        for (let z = Math.min(warehouse.area.corner1.z, warehouse.area.corner2.z); z <= Math.max(warehouse.area.corner1.z, warehouse.area.corner2.z); z++) {
          for (let x = Math.min(warehouse.area.corner1.x, warehouse.area.corner2.x); x <= Math.max(warehouse.area.corner1.x, warehouse.area.corner2.x); x++) {
            const block = dim.getBlock({ x, y, z });
            if (block !== undefined && isSupportedContainerType(block.typeId)) {
              found.push({ coord: `${x},${y},${z}`, type: block.typeId });
            }
          }
        }
      }
      if (found.length === 0) {
        player.sendMessage(`${chat.muted}区域内容器为空`);
        return;
      }
      const table = new Table().header("坐标", "类型");
      for (const row of found) table.row(row.coord, row.type);
      player.sendMessage(`${chat.warn}预览：${found.length} 个容器\n${table.render()}`);
    });
  });
}