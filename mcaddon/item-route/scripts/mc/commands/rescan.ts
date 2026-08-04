// ─── ir:rescan 重扫容器（member+） ───────────────────────
import { world, system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { nameCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";
import { scanWarehouseArea } from "./scan";

export function registerRescan(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, nameCommand("ir:rescan", "重新扫描仓库区域容器（member+）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage("§c仓库不存在");
      return;
    }
    if (!requireRole(deps.members, warehouse, player.id, "member")) {
      player.sendMessage("§c需要 member 及以上权限");
      return;
    }
    system.runTimeout(() => {
      const dim = world.getDimension(warehouse.area.dimension);
      if (dim === undefined) {
        player.sendMessage("§c维度加载失败");
        return;
      }
      const result = scanWarehouseArea(dim, warehouse.area, deps.factory, deps.index, warehouse, deps.persistContainers);
      if (result.skipped) {
        player.sendMessage(`§e区域过大（>${40_000} 格）已跳过，请缩小区域或手动放置注册`);
        return;
      }
      player.sendMessage(`§a扫描完成：${result.scanned} 格，新注册 ${result.registered} 容器（共 ${warehouse.containers.size}）`);
    });
  });
}