import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry } from "../bootstrap/context";
import { guardBotCommand } from "./auth";
import { requireBot } from "../../bot/Bot";
export function registerOfflineCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:offline", description: "将假人下线，保留所有状态记录",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}请指定假人名字`); return; }
    const denied = guardBotCommand(player, targetName);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }
    let bot;
    try { bot = requireBot(targetName, botRegistry); }
    catch { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`); return; }
    if (!bot.isOnline) { player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 已经离线`); return; }
    bot.takeOffline();
    player.sendMessage(`${color.success}假人 ${color.playerName}${targetName}${color.success} 已下线`);
  });
}
