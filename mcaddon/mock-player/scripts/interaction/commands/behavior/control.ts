// ─── /mp:control — 控制模式 ──────────────────────────

import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { TAG_CONTROL } from "../../../rules/tags/BotTags";
import { resolveBotForCommand } from "../auth";

export function registerControlCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:control",
    description: "体态控制：开启后假人持续跟随玩家位置/朝向/视角",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [{ name: "enable", type: CustomCommandParamType.Boolean }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}用法: /mp:control <假人> [true|false]`); return; }

    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;

    const turnOn = (params.enable as boolean | undefined) ?? true;
    const isOn = bot.hasTag(TAG_CONTROL.value);
    if (turnOn && !isOn) { bot.toggleControl(player); player.sendMessage(`${color.success}已开启假人 ${color.playerName}${targetName}${color.success} 的体态控制`); }
    else if (!turnOn && isOn) { bot.toggleControl(player); player.sendMessage(`${color.playerName}已关闭假人 ${color.playerName}${targetName}${color.playerName} 的体态控制，体态固定`); }
    else { player.sendMessage(turnOn ? `${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 已处于控制模式` : `${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 未处于控制模式`); }
  });
}
