import { system, CommandPermissionLevel, CustomCommandParamType, type CustomCommand } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { canManageWarehouse } from "../util/PlayerAuth";
import { normalizeWarehouseId } from "../storage/WarehouseRepository";

const nameCmd = (n: string, d: string): CustomCommand => ({
  name: n, description: d, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
  mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
});

export function registerRescanPreview(registry: any, service: WarehouseService): void {
  defineCommand(registry, nameCmd("sw:rescan_preview", "预览 SmartWarehouse 仓库容器变更"),
    ({ player, params }) => {
      if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令"); return; }
      let id: string;
      try { id = normalizeWarehouseId(params.name as string); } catch (e) { player.sendMessage(`§c${(e as Error).message}`); return; }
      system.runTimeout(() => {
        try { const diff = service.previewRescanWarehouse(id); player.sendMessage(`§7[预览] 仓库 "${id}" 重扫变更：新增 §a${diff.added.length}§7，移除 §c${diff.removed.length}§7，变化 §e${diff.changed.length}§7，未变 §f${diff.unchanged.length}`); }
        catch (e) { player.sendMessage(`§c预览失败: ${(e as Error).message}`); }
      });
    });
}
