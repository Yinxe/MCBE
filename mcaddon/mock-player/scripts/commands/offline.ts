import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry } from "../features/persistence";
import { offlineBot } from "../features/operations";
export function registerOfflineCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:offline", description: "将假人下线，保留所有状态记录",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c请指定假人名字"); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    if (!record.online) { player.sendMessage(`§e假人 §e${targetName}§e 已经离线`); return; }
    offlineBot(record);
    player.sendMessage(`§a假人 §e${record.name}§a 已下线`);
  });
}
