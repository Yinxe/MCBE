import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry } from "../bootstrap/context";
import { guardBotCommand } from "./auth";
import { requireBot } from "../../bot/Bot";
export function registerTpCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:tp", description: "传送到假人身边",
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
    try {
      bot.tpPlayerHere(player);
      player.sendMessage(`${color.success}已传送到假人 ${color.playerName}${targetName}${color.success} 身边`);
    } catch (e: any) {
      player.sendMessage(`${color.error}传送失败: ${e?.message ?? e}`);
    }
  });
}
export function registerTpHereCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:tphere", description: "让假人传送到玩家身边",
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
    try {
      bot.tpToPlayer(player);
      player.sendMessage(`${color.success}假人 ${color.playerName}${targetName}${color.success} 已传送到你身边`);
    } catch (e: any) {
      player.sendMessage(`${color.error}传送失败: ${e?.message ?? e}`);
    }
  });
}
