import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { nameCmd, requireOp, parseId, msg } from "./helpers";

export function registerRescanPreview(registry: any, service: WarehouseService): void {
  defineCommand(registry, nameCmd("sw:rescan_preview", "预览 SmartWarehouse 仓库容器变更"),
    ({ player, params }) => {
      if (!requireOp(player)) return;
      const id = parseId(params.name as string);
      if (!id.ok) { msg(player, `§c${id.message}`); return; }
      system.runTimeout(() => {
        try {
          const diff = service.previewRescanWarehouse(id.id);
          msg(player, `§7[预览] 仓库 "${id.id}" 重扫变更：新增 §a${diff.added.length}§7，移除 §c${diff.removed.length}§7，变化 §e${diff.changed.length}§7，未变 §f${diff.unchanged.length}`);
        } catch (e) { msg(player, `§c预览失败: ${e instanceof Error ? e.message : String(e)}`); }
      });
    });
}
