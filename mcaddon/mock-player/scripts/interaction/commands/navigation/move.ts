import { Vector3, system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { resolveBotForCommand } from "../auth";
export function registerMoveCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:move", description: "让模拟玩家自动寻路到指定坐标",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [{ name: "location", type: CustomCommandParamType.Location }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}用法: /mp:move <假人> [x] [y] [z]`); return; }
    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;
    const loc = (params.location as Vector3 | undefined) ?? player.location;
    // 异步等待到达（navigateTo 闭包内 runInterval 分帧检查，命令不阻塞主线程）
    system.run(async () => {
      try {
        const ok = await bot.navigateTo(loc);
        player.sendMessage(ok
          ? `${color.success}假人 ${color.playerName}${targetName}${color.success} 已到达 ${color.playerName}${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`
          : `${color.warn}假人 ${color.playerName}${targetName}${color.warn} 未能到达目标（路径不可达/超时/实体失效）`);
      } catch (e: any) {
        player.sendMessage(`${color.error}移动假人失败: ${e?.message ?? e}`);
      }
    });
  });
}
