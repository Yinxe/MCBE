// ─── ir:resize 调整区域（owner） ─────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { regionCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";

export function registerResize(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, regionCommand("ir:resize", "调整仓库区域（owner）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage("§c仓库不存在");
      return;
    }
    if (!requireRole(deps.members, warehouse, player.id, "owner")) {
      player.sendMessage("§c需要 owner 权限");
      return;
    }
    const area = {
      dimension: player.dimension.id,
      corner1: { x: params.x1 as number, y: params.y1 as number, z: params.z1 as number },
      corner2: { x: params.x2 as number, y: params.y2 as number, z: params.z2 as number },
    };
    system.runTimeout(() => {
      deps.warehouses.updateArea(warehouse, area);
      player.sendMessage(`§a仓库 "${warehouse.displayName}" 区域已调整`);
    });
  });
}