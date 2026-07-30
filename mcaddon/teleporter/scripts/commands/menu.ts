import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { showMainMenu } from "../ui/menu";

export function registerMenuCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:menu",
    description: "打开传送管理菜单",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    showMainMenu(player);
  });
}
