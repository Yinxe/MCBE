import { world, system, CommandPermissionLevel, CustomCommandParamType, type CustomCommand } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { SearchService, formatSearchResult } from "../warehouse/SearchService";
import { startMarkerParticles } from "../ui/SearchUI";
import { filterNearbyOwnedWarehouses } from "../util/Vector";
import { WAREHOUSE_NEARBY_MARGIN } from "../types";
import { canManageWarehouse } from "../util/PlayerAuth";

const nameCmd = (n: string, d: string): CustomCommand => ({
  name: n, description: d, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
  mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
});

export function registerSearch(registry: any, repository: WarehouseRepository, configStore: ModConfigStore): void {
  defineCommand(registry, nameCmd("sw:search", "在附近仓库搜索物品"),
    ({ player, params }) => {
      if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令"); return; }
      const all = repository.loadAll();
      const admin = canManageWarehouse(player);
      const nearby = filterNearbyOwnedWarehouses(all, player.dimension.id, { x: player.location.x, z: player.location.z }, WAREHOUSE_NEARBY_MARGIN, player.id, admin);
      if (nearby.length === 0) { player.sendMessage("§c附近没有找到属于你的仓库"); return; }
      const t = nearby[0];
      system.runTimeout(() => {
        try {
          const dim = world.getDimension(t.dimensionId);
          const svc = new SearchService();
          const r = svc.search(t, params.query as string, dim);
          for (const line of formatSearchResult(r)) player.sendMessage(line);
          if (r.containerCount > 0) {
            const locs = svc.getMarkerLocations(r);
            if (locs.length > 0) startMarkerParticles(player, t.dimensionId, locs.map(l => ({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) })), configStore);
          }
        } catch (e) { player.sendMessage(`§c搜索失败: ${(e as Error).message}`); }
      });
    });
}
