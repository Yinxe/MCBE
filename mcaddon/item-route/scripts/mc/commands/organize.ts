// ─── ir:organize 整理当前所在仓库 ────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { noParamCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { findWarehouseAt } from "../../core/model/Area";
import { MoveJournal } from "../../core/routing/Move";
import { formatOrganizeResult } from "../ui/OrganizeFormatter";

export function registerOrganize(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, noParamCommand("ir:organize", "整理玩家所在仓库"), ({ player }) => {
    system.runTimeout(() => {
      const warehouse = findWarehouseAt(deps.loadedWarehouses(), player.dimension.id, {
        x: Math.floor(player.location.x),
        y: Math.floor(player.location.y),
        z: Math.floor(player.location.z),
      });
      if (warehouse === undefined) {
        player.sendMessage(`${chat.error}你不在任何仓库区域内`);
        return;
      }
      const res = deps.organize.organize(warehouse, new MoveJournal());
      for (const line of formatOrganizeResult(res, warehouse.displayName)) {
        player.sendMessage(line);
      }
    });
  });
}