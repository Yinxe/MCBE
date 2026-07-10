import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { nameCmd, requireOp, parseId, msg } from "./helpers";

export function registerDelete(registry: any, service: WarehouseService): void {
  defineCommand(registry, nameCmd("sw:delete", "删除 SmartWarehouse 仓库"),
    ({ player, params }) => {
      if (!requireOp(player)) return;
      const id = parseId(params.name as string);
      if (!id.ok) { msg(player, `§c${id.message}`); return; }
      system.runTimeout(() => {
        try { service.deleteWarehouse(id.id); msg(player, `§a仓库 ${id.id} 已删除`); }
        catch (e) { msg(player, `§c删除失败: ${e instanceof Error ? e.message : String(e)}`); }
      });
    });
}
