import { system, CommandPermissionLevel, CustomCommandParamType, type CustomCommand } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { canManageWarehouse } from "../util/PlayerAuth";
import { normalizeWarehouseId } from "../storage/WarehouseRepository";

const nameCmd = (n: string, d: string): CustomCommand => ({
  name: n, description: d, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
  mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
});

export function registerDelete(registry: any, service: WarehouseService): void {
  defineCommand(registry, nameCmd("sw:delete", "删除 SmartWarehouse 仓库"),
    ({ player, params }) => {
      if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令"); return; }
      let id: string;
      try { id = normalizeWarehouseId(params.name as string); } catch (e) { player.sendMessage(`§c${(e as Error).message}`); return; }
      system.runTimeout(() => {
        try { service.deleteWarehouse(id); player.sendMessage(`§a仓库 ${id} 已删除`); }
        catch (e) { player.sendMessage(`§c删除失败: ${(e as Error).message}`); }
      });
    });
}
