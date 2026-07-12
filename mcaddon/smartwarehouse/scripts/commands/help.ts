import { system, CommandPermissionLevel } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { showHelpGuide } from "../ui/HelpGuide";

export function registerHelpCommand(registry: any): void {
  defineCommand(registry, {
    name: "sw:help", description: "查看 SmartWarehouse 帮助手册",
    permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
    mandatoryParameters: [],
  }, ({ player }) => {
    system.run(() => { showHelpGuide(player); });
  });
}
