import { system, type Vector3 } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { regionCmd, requireOp, parseId, msg } from "./helpers";

export function registerResize(registry: any, service: WarehouseService): void {
  defineCommand(registry, regionCmd("sw:resize", "调整 SmartWarehouse 仓库区域"),
    ({ player, params }) => {
      if (!requireOp(player)) return;
      const id = parseId(params.name as string);
      if (!id.ok) { msg(player, `§c${id.message}`); return; }
      const pA = { x: Math.floor((params.pos1 as Vector3).x), y: Math.floor((params.pos1 as Vector3).y), z: Math.floor((params.pos1 as Vector3).z) };
      const pB = { x: Math.floor((params.pos2 as Vector3).x), y: Math.floor((params.pos2 as Vector3).y), z: Math.floor((params.pos2 as Vector3).z) };
      system.runTimeout(() => {
        try {
          const wh = service.resizeWarehouse(id.id, pA, pB);
          msg(player, `§a仓库 "${wh.displayName}" 调整成功！共发现 ${Object.keys(wh.containers).length} 个容器`);
        } catch (e) { msg(player, `§c调整失败: ${e instanceof Error ? e.message : String(e)}`); }
      });
    });
}
