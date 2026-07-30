import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry } from "../features/core/persistence";
import { showTridentSelector } from "../ui/trident";

export function registerTridentCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:trident",
    description: "让假人投掷手中的三叉戟或打开选择表单",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const botName = params.name as string;
    if (!botName) { player.sendMessage("§c用法: /mp:trident <假人>"); return; }
    const record = botRegistry.get(botName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${botName}§c 的记录`); return; }
    if (!record.online || record.death) { player.sendMessage("§c假人不在线或已死亡"); return; }

    // 命令走 UI 选择
    showTridentSelector(player, botName);
  });
}
