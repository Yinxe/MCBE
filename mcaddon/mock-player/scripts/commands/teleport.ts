import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry } from "../features/core/persistence";
import { tpPlayerToBot, tpBotToPlayer } from "../features/teleport";
export function registerTpCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:tp", description: "传送到假人身边",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c请指定假人名字"); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    tpPlayerToBot(player, record);
    player.sendMessage(`§a已传送到假人 §e${targetName}§a 身边`);
  });
}
export function registerTpHereCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:tphere", description: "让假人传送到玩家身边",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c请指定假人名字"); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    tpBotToPlayer(record, player);
    player.sendMessage(`§a假人 §e${targetName}§a 已传送到你身边`);
  });
}
