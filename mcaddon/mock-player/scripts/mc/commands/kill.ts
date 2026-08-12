import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry } from "../bootstrap/context";
import { guardBotCommand } from "./auth";
import { killBot } from "../features/killBot";
export function registerKillCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:kill", description: "杀死一个在线的假人",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}请指定假人名字`); return; }
    const denied = guardBotCommand(player, targetName);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`); return; }
    if (!record.online) { player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 不在线，无法杀死`); return; }
    if (record.death) { player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 已经死亡，无需重复杀死`); return; }
    killBot(record);
    player.sendMessage(`${color.success}已杀死假人 ${color.playerName}${targetName}`);
  });
}
