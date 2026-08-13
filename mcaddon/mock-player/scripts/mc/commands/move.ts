import { Vector3, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry } from "../bootstrap/context";
import { botManager } from "../bot/BotManager";
import { navigateToTask } from "../bot/tasks";
import { guardBotCommand } from "./auth";

export function registerMoveCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:move", description: "让模拟玩家自动寻路到指定坐标",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [{ name: "location", type: CustomCommandParamType.Location }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}用法: /mp:move <假人> [x] [y] [z]`); return; }
    const denied = guardBotCommand(player, targetName);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`); return; }
    if (!record.online || record.death) { player.sendMessage(`${color.error}模拟玩家不在线或已死亡`); return; }

    const loc = (params.location as Vector3 | undefined) ?? player.location;
    const bot = botManager.getOrCreate(record);

    // 导航任务（实例引擎驱动）：一次性下发 + 到达检查 + 超时
    const task = navigateToTask(bot, loc, {
      arriveDist: 1.5,
      timeoutTicks: 1200, // 60 秒超时
      onArrive: () => player.sendMessage(
        `${color.success}假人 ${color.playerName}${targetName}${color.success} 已到达 ${color.playerName}${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`,
      ),
    });
    if (!bot.startTask(task)) {
      player.sendMessage(`${color.warn}假人 ${color.playerName}${targetName}${color.warn} 已有任务进行中（${bot.activeTaskId}）`);
      return;
    }
    player.sendMessage(`${color.success}假人 ${color.playerName}${targetName}${color.success} 正在前往 ${color.playerName}${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`);
  });
}
