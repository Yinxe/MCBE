import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry } from "../features/core/persistence";
import { killBot } from "../features/killBot";
export function registerKillCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:kill", description: "杀死一个在线的假人",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c请指定假人名字"); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    if (!record.online) { player.sendMessage(`§e假人 §e${targetName}§e 不在线，无法杀死`); return; }
    if (record.death) { player.sendMessage(`§e假人 §e${targetName}§e 已经死亡，无需重复杀死`); return; }
    killBot(record);
    player.sendMessage(`§a已杀死假人 §e${targetName}`);
  });
}
