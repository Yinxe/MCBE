import { CommandPermissionLevel } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { giveTeleportToken } from "../teleporter/token";

export function registerTokenCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:token",
    description: "获得传送信物（右键打开传送菜单）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    giveTeleportToken(player);
  });
}
