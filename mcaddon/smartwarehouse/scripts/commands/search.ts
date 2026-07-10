import { world, system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { SearchService, formatSearchResult } from "../warehouse/SearchService";
import { startMarkerParticles } from "../ui/SearchUI";
import { filterNearbyOwnedWarehouses } from "../util/Vector";
import { WAREHOUSE_NEARBY_MARGIN } from "../types";
import { nameCmd, requireOp, msg } from "./helpers";

export function registerSearch(registry: any, repository: WarehouseRepository, configStore: ModConfigStore): void {
  defineCommand(registry, nameCmd("sw:search", "在附近仓库搜索物品"),
    ({ player, params }) => {
      if (!requireOp(player)) return;
      const warehouses = repository.loadAll();
      const isAdmin = requireOp(player);
      const nearby = filterNearbyOwnedWarehouses(warehouses, player.dimension.id, { x: player.location.x, z: player.location.z }, WAREHOUSE_NEARBY_MARGIN, player.id, isAdmin);
      if (nearby.length === 0) { msg(player, "§c附近没有找到属于你的仓库"); return; }
      const target = nearby[0];
      system.runTimeout(() => {
        try {
          const dim = world.getDimension(target.dimensionId);
          const svc = new SearchService();
          const r = svc.search(target, params.query as string, dim);
          for (const line of formatSearchResult(r)) msg(player, line);
          if (r.containerCount > 0) {
            const locs = svc.getMarkerLocations(r);
            if (locs.length > 0) startMarkerParticles(player, target.dimensionId, locs.map(l => ({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) })), configStore);
          }
        } catch (e) { msg(player, `§c搜索失败: ${e instanceof Error ? e.message : String(e)}`); }
      });
    });
}
