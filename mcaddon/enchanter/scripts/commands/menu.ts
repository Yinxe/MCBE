import { CommandPermissionLevel } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { showMainMenu } from "../ui/menu";

export function registerMenuCommand(registry: any): void {
  defineCommand(registry, {
    name: "en:menu",
    description: "打开高级附魔菜单",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    showMainMenu(player);
  });
}
