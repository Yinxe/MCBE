// ─── ir:search 搜索物品（visitor+） ─────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { queryCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { runSearch, startMarkerParticles } from "../ui/SearchUI";
import type { Location } from "../../core/model/types";

export function registerSearch(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, queryCommand("ir:search", "搜索仓库物品（visitor+）"), ({ player, params }) => {
    system.runTimeout(() => {
      const lines = runSearch(deps, params.query as string);
      if (lines.length === 0) {
        player.sendMessage("§7未找到匹配物品");
        return;
      }
      player.sendMessage(`§d━━ 搜索结果：${lines.length} 种 ━━`);
      const locs: Location[] = [];
      for (const line of lines) {
        player.sendMessage(`§f${line.name}§7 ×${line.count} §8[${line.containerIds.join(", ")}]`);
        for (const id of line.containerIds) {
          for (const w of deps.loadedWarehouses()) {
            const c = w.containers.get(id);
            if (c) locs.push(...c.occupiedLocations);
          }
        }
      }
      if (locs.length > 0) startMarkerParticles(player, player.dimension.id, locs);
    });
  });
}