import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry } from "../features/persistence";
import { deleteBot } from "../features/operations";
export function registerDeleteCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:delete", description: "删除指定假人",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c请指定假人名字"); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    deleteBot(record, player);
    player.sendMessage(`§a已删除假人 §e${targetName}，物品和经验已回收`);
  });
}
