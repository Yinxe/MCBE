import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { nameCmd, requireOp, parseId, msg } from "./helpers";

export function registerRescan(registry: any, service: WarehouseService): void {
  defineCommand(registry, nameCmd("sw:rescan", "重新扫描 SmartWarehouse 仓库容器"),
    ({ player, params }) => {
      if (!requireOp(player)) return;
      const id = parseId(params.name as string);
      if (!id.ok) { msg(player, `§c${id.message}`); return; }
      system.runTimeout(() => {
        try {
          const wh = service.rescanWarehouse(id.id);
          msg(player, `§a仓库 "${wh.displayName}" 重新扫描完成！共发现 ${Object.keys(wh.containers).length} 个容器`);
        } catch (e) { msg(player, `§c重新扫描失败: ${e instanceof Error ? e.message : String(e)}`); }
      });
    });
}
