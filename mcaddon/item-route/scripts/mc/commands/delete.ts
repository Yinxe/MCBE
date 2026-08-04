// ─── ir:delete 删除仓库（owner） ─────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { nameCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";

export function registerDelete(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, nameCommand("ir:delete", "删除仓库（owner）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage("§c仓库不存在");
      return;
    }
    if (!requireRole(deps.members, warehouse, player.id, "owner")) {
      player.sendMessage("§c需要 owner 权限");
      return;
    }
    system.runTimeout(() => {
      deps.warehouses.deleteWarehouse(warehouse.id);
      player.sendMessage(`§a仓库 "${warehouse.displayName}" 已删除`);
    });
  });
}