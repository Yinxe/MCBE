// ─── ir:search 在你有权限的最近仓库搜索物品（member+） ─────
// v1 语义：只搜玩家有权限（owner/member）的**最近**仓库，不跨仓；结果 + 粒子标记都限定该仓。
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { queryCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { nearestWarehouseByPermission } from "../../core/model/Area";
import { runSearch, startMarkerParticles } from "../ui/SearchUI";
import type { Location } from "../../core/model/types";

export function registerSearch(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, queryCommand("ir:search", "在你有权限的最近仓库搜索物品（member+）"), ({ player, params }) => {
    system.runTimeout(() => {
      // 权限：仅 owner/member 可搜；就近取该玩家有权限的仓库（v1 filterNearbyOwned 同义）
      const warehouse = nearestWarehouseByPermission(
        deps.loadedWarehouses(),
        player.dimension.id,
        { x: player.location.x, z: player.location.z },
        (w) => deps.members.can(w, player.id, "member")
      );
      if (warehouse === undefined) {
        player.sendMessage(`${chat.error}附近没有你有权限（成员）的仓库`);
        return;
      }
      const lines = runSearch(warehouse, params.query as string);
      if (lines.length === 0) {
        player.sendMessage(`${chat.muted}未找到匹配物品`);
        return;
      }
      player.sendMessage(`${chat.highlight}━━ ${warehouse.displayName} 搜索结果：${lines.length} 种 ━━`);
      const locs: Location[] = [];
      for (const line of lines) {
        player.sendMessage(`${chat.info}${line.name}${chat.muted} ×${line.count} [${line.containerIds.join(", ")}]`);
        for (const id of line.containerIds) {
          const c = warehouse.containers.get(id);
          if (c) locs.push(...c.occupiedLocations);
        }
      }
      if (locs.length > 0) startMarkerParticles(player, player.dimension.id, locs, (t) => deps.config.isToken(t));
    });
  });
}
