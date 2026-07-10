import { CommandPermissionLevel } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { showMainMenu } from "../ui/menu";
export function registerMenuCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:menu", description: "打开模拟玩家管理菜单",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => { showMainMenu(player); });
}
