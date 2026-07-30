import { system, CommandPermissionLevel } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { showDeathPointsList } from "../ui/deathpoints";

export function registerDeathPointsCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:deathpoints",
    description: "查看并传送至死亡点",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    showDeathPointsList(player);
  });
}
