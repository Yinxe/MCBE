import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry, loadBotRecord } from "../features/persistence";
import { onlineBot } from "../features/operations";
export function registerOnlineCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:online", description: "将一个已创建的假人上线并恢复所有状态",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c请指定假人名字"); return; }
    const record = botRegistry.get(targetName) ?? loadBotRecord(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    if (record.online) { player.sendMessage(`§e假人 §e${targetName}§e 已经在线`); return; }
    onlineBot(record);
    player.sendMessage(`§a假人 §e${record.name}§a 已上线`);
  });
}
