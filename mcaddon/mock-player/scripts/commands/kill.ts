import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { resolveBotForCommand } from "./auth";

export function registerKillCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:kill", description: "杀死一个在线的假人",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}请指定假人名字`); return; }
    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;
    if (!bot.isOnline) { player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 不在线，无法杀死`); return; }
    if (bot.isDeath) { player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 已经死亡，无需重复杀死`); return; }
    try {
      bot.kill();
      player.sendMessage(`${color.success}已杀死假人 ${color.playerName}${targetName}`);
    } catch (e: any) {
      player.sendMessage(`${color.error}杀死假人失败: ${e?.message ?? e}`);
    }
  });
}
