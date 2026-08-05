// ─── ir:resize 调整区域（owner） ─────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { regionCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { resolveWarehouseByName, requireRole } from "./auth";

export function registerResize(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, regionCommand("ir:resize", "调整仓库区域（owner）"), ({ player, params }) => {
    const warehouse = resolveWarehouseByName(deps.loadedWarehouses(), params.name as string);
    if (warehouse === undefined) {
      player.sendMessage(`${chat.error}仓库不存在`);
      return;
    }
    if (!requireRole(deps.members, warehouse, player.id, "owner")) {
      player.sendMessage(`${chat.error}需要 owner 权限`);
      return;
    }
    const p1 = params.pos1 as { x: number; y: number; z: number };
    const p2 = params.pos2 as { x: number; y: number; z: number };
    const area = {
      dimension: player.dimension.id,
      corner1: { x: Math.floor(p1.x), y: Math.floor(p1.y), z: Math.floor(p1.z) },
      corner2: { x: Math.floor(p2.x), y: Math.floor(p2.y), z: Math.floor(p2.z) },
    };
    system.runTimeout(() => {
      const err = deps.warehouses.updateArea(warehouse, area);
      if (err !== undefined) {
        player.sendMessage(`${chat.error}${err}`);
        return;
      }
      player.sendMessage(`${chat.success}仓库 "${warehouse.displayName}" 区域已调整`);
      deps.bus.visualEffect.trigger({ type: "visual-effect", kind: "boundary-glow", warehouseId: warehouse.id });
    });
  });
}