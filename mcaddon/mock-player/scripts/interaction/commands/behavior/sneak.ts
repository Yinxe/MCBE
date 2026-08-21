// ─── /mp:sneak — 潜行切换（OOP：Bot.setSneaking） ─────

import { Player, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { resolveBotForCommand } from "../auth";

export function registerSneakCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:sneak",
    description: "设置假人的潜行状态",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [{ name: "sneak", type: CustomCommandParamType.Boolean }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) {
      player.sendMessage(`${color.error}用法: /mp:sneak <假人> [true|false]`);
      return;
    }
    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;
    const shouldSneak = params.sneak !== undefined ? (params.sneak as boolean) : true;
    bot.setSneaking(shouldSneak);
    player.sendMessage(shouldSneak ? `${color.success}假人 ${color.playerName}${targetName}${color.success} 已潜行` : `${color.success}假人 ${color.playerName}${targetName}${color.success} 已站起`);
  });
}
