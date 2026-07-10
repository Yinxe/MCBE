import { system, CommandPermissionLevel, CustomCommandParamType, type CustomCommand } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { canManageWarehouse } from "../util/PlayerAuth";
import { normalizeWarehouseId } from "../storage/WarehouseRepository";

const nameCmd = (n: string, d: string): CustomCommand => ({
  name: n, description: d, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
  mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
});

export function registerRescan(registry: any, service: WarehouseService): void {
  defineCommand(registry, nameCmd("sw:rescan", "重新扫描 SmartWarehouse 仓库容器"),
    ({ player, params }) => {
      if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令"); return; }
      let id: string;
      try { id = normalizeWarehouseId(params.name as string); } catch (e) { player.sendMessage(`§c${(e as Error).message}`); return; }
      system.runTimeout(() => {
        try { const wh = service.rescanWarehouse(id); player.sendMessage(`§a仓库 "${wh.displayName}" 重新扫描完成！共发现 ${Object.keys(wh.containers).length} 个容器`); }
        catch (e) { player.sendMessage(`§c重新扫描失败: ${(e as Error).message}`); }
      });
    });
}
