import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry } from "../features/core/persistence";
import { deleteBot } from "../features/deleteBot";
export function registerDeleteCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:delete", description: "删除指定假人",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}请指定假人名字`); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`); return; }
    deleteBot(record, player);
    player.sendMessage(`${color.success}已删除假人 ${color.playerName}${targetName}，物品和经验已回收`);
  });
}
