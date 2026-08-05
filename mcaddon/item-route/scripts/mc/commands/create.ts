// ─── ir:create 建仓 ─────────────────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { regionCommand } from "./defs";
import type { CommandDeps } from "./deps";

export function registerCreate(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, regionCommand("ir:create", "创建物品路由仓库区域"), ({ player, params }) => {
    const name = (params.name as string).trim();
    const p1 = params.pos1 as { x: number; y: number; z: number };
    const p2 = params.pos2 as { x: number; y: number; z: number };
    const area = {
      dimension: player.dimension.id,
      corner1: { x: Math.floor(p1.x), y: Math.floor(p1.y), z: Math.floor(p1.z) },
      corner2: { x: Math.floor(p2.x), y: Math.floor(p2.y), z: Math.floor(p2.z) },
    };
    system.runTimeout(() => {
      const result = deps.warehouses.createWarehouse(name, player.id, area);
      if (!result.ok) {
        player.sendMessage(`${chat.error}${result.error}`);
        return;
      }
      player.sendMessage(`${chat.success}仓库 "${result.warehouse.displayName}" 创建成功！可 /ir:rescan 扫描容器`);
      deps.bus.visualEffect.trigger({
        type: "visual-effect",
        kind: "boundary-glow",
        warehouseId: result.warehouse.id,
      });
    });
  });
}