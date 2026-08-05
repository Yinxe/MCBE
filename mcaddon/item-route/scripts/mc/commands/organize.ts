// ─── ir:organize 整理当前所在仓库 ────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { chat } from "../ui/uiColor";
import { noParamCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { findWarehouseAt } from "../../core/model/Area";
import { MoveJournal } from "../../core/routing/Move";

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
      const ok = deps.organize.organize(warehouse, new MoveJournal());
      player.sendMessage(ok ? `${chat.success}整理完成` : `${chat.error}整理失败`);
    });
  });
}