// ─── ir:create 建仓 ─────────────────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { regionCommand } from "./defs";
import type { CommandDeps } from "./deps";

export function registerCreate(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, regionCommand("ir:create", "创建物品路由仓库区域"), ({ player, params }) => {
    const name = (params.name as string).trim();
    const area = {
      dimension: player.dimension.id,
      corner1: { x: params.x1 as number, y: params.y1 as number, z: params.z1 as number },
      corner2: { x: params.x2 as number, y: params.y2 as number, z: params.z2 as number },
    };
    system.runTimeout(() => {
      const result = deps.warehouses.createWarehouse(name, player.id, area);
      if (!result.ok) {
        player.sendMessage(`§c${result.error}`);
        return;
      }
      player.sendMessage(`§a仓库 "${result.warehouse.displayName}" 创建成功！可 /ir:rescan 扫描容器`);
      deps.bus.visualEffect.trigger({
        type: "visual-effect",
        kind: "boundary-glow",
        warehouseId: result.warehouse.id,
      });
    });
  });
}