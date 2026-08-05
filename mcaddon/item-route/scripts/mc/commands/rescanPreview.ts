// ─── ir:rescan_preview 预览重扫（member+，不写索引） ─────
import { world, system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { nameCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";
import { MAX_SCAN_VOLUME } from "./scan";
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
      // 体积上限保护：与 rescan 一致，超限跳过（否则超大区域三重循环卡顿）
      const minX = Math.min(warehouse.area.corner1.x, warehouse.area.corner2.x);
      const maxX = Math.max(warehouse.area.corner1.x, warehouse.area.corner2.x);
      const minY = Math.min(warehouse.area.corner1.y, warehouse.area.corner2.y);
      const maxY = Math.max(warehouse.area.corner1.y, warehouse.area.corner2.y);
      const minZ = Math.min(warehouse.area.corner1.z, warehouse.area.corner2.z);
      const maxZ = Math.max(warehouse.area.corner1.z, warehouse.area.corner2.z);
      const volume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
      if (volume > MAX_SCAN_VOLUME) {
        player.sendMessage(`${chat.error}区域体积超限（最大 ${MAX_SCAN_VOLUME} 格），请缩小区域`);
        return;
      }
      // 收集结构化行（坐标/类型），避免在数据里混颜色码再 split 的脆弱写法
      const found: Array<{ coord: string; type: string }> = [];
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          for (let x = minX; x <= maxX; x++) {
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