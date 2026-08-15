import { system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry, botStore } from "../../../bootstrap/context";
import { guardBotCommand } from "../auth";
import { onlineBot } from "../../../features/manage/onlineBot";
export function registerOnlineCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:online", description: "将一个已创建的假人上线并恢复所有状态",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}请指定假人名字`); return; }
    const denied = guardBotCommand(player, targetName);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }
    const record = botRegistry.get(targetName) ?? botStore.loadRecord(targetName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`); return; }
    if (record.online) { player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 已经在线`); return; }
    system.run(async () => {
      // onlineBot 永不 reject（失败 resolve undefined）
      const bot = await onlineBot(record);
      if (!bot) {
        player.sendMessage(`${color.error}${record.name} 上线失败`);
        return;
      }
      player.sendMessage(`${color.success}假人 ${color.playerName}${record.name}${color.success} 已上线`);
    });
  });
}
