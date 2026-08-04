// ─── ir:menu 主菜单 ─────────────────────────────────────
import { system } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { noParamCommand } from "./defs";
import type { CommandDeps } from "./deps";
import { showMainMenu } from "../ui/MainMenu";

export function registerMenu(registry: Parameters<typeof defineCommand>[0], deps: CommandDeps): void {
  defineCommand(registry, noParamCommand("ir:menu", "打开主菜单"), ({ player }) => {
    system.runTimeout(() => {
      void showMainMenu(player, deps);
    });
  });
}