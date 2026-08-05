// ─── ir:delete 删除仓库（owner） ─────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { nameCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";

export function registerDelete(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, nameCommand("ir:delete", "删除仓库（owner）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage(`${chat.error}仓库不存在`);
      return;
    }
    if (!requireRole(deps.members, warehouse, player.id, "owner")) {
      player.sendMessage(`${chat.error}需要 owner 权限`);
      return;
    }
    system.runTimeout(() => {
      deps.warehouses.deleteWarehouse(warehouse.id);
      player.sendMessage(`${chat.success}仓库 "${warehouse.displayName}" 已删除`);
    });
  });
}