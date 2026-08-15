import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { resolveBotForCommand } from "./auth";
import { showTridentSelector } from "../ui/trident";

export function registerTridentCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:trident",
    description: "让假人投掷手中的三叉戟或打开选择表单",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const botName = params.name as string;
    const bot = resolveBotForCommand(player, botName);
    if (!bot) return;
    if (!bot.isAvailable) { player.sendMessage(`${color.error}假人不在线或已死亡`); return; }

    // 命令走 UI 选择
    showTridentSelector(player, botName);
  });
}
