import { system, CommandPermissionLevel, CustomCommandParamType, type CustomCommand, type Vector3 } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { canManageWarehouse } from "../util/PlayerAuth";
import { normalizeWarehouseId } from "../storage/WarehouseRepository";

const regionCmd = (n: string, d: string): CustomCommand => ({
  name: n, description: d, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
  mandatoryParameters: [
    { name: "name", type: CustomCommandParamType.String },
    { name: "pos1", type: CustomCommandParamType.Location },
    { name: "pos2", type: CustomCommandParamType.Location },
  ],
});

export function registerResize(registry: any, service: WarehouseService): void {
  defineCommand(registry, regionCmd("sw:resize", "调整 SmartWarehouse 仓库区域"),
    ({ player, params }) => {
      if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令"); return; }
      let id: string;
      try { id = normalizeWarehouseId(params.name as string); } catch (e) { player.sendMessage(`§c${(e as Error).message}`); return; }
      const pA = { x: Math.floor((params.pos1 as Vector3).x), y: Math.floor((params.pos1 as Vector3).y), z: Math.floor((params.pos1 as Vector3).z) };
      const pB = { x: Math.floor((params.pos2 as Vector3).x), y: Math.floor((params.pos2 as Vector3).y), z: Math.floor((params.pos2 as Vector3).z) };
      system.runTimeout(() => {
        try { const wh = service.resizeWarehouse(id, pA, pB); player.sendMessage(`§a仓库 "${wh.displayName}" 调整成功！共发现 ${Object.keys(wh.containers).length} 个容器`); }
        catch (e) { player.sendMessage(`§c调整失败: ${(e as Error).message}`); }
      });
    });
}
