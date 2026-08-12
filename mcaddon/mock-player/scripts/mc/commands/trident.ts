import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry } from "../bootstrap/context";
import { showTridentSelector } from "../ui/trident";

export function registerTridentCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:trident",
    description: "让假人投掷手中的三叉戟或打开选择表单",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const botName = params.name as string;
    const record = botRegistry.get(botName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${botName}${color.error} 的记录`); return; }
    if (!record.online || record.death) { player.sendMessage(`${color.error}假人不在线或已死亡`); return; }

    // 命令走 UI 选择
    showTridentSelector(player, botName);
  });
}
