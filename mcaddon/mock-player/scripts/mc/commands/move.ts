import { Vector3, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry } from "../bootstrap/context";
import { guardBotCommand } from "./auth";
import { moveBot } from "../features/move";
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
    const loc = (params.location as Vector3 | undefined) ?? player.location;
    try {
      const ok = moveBot(record, loc);
      player.sendMessage(ok
        ? `${color.success}假人 ${color.playerName}${targetName}${color.success} 正在前往 ${color.playerName}${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`
        : `${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 无法完全到达目标位置，但已开始移动`);
    } catch (e: any) {
      player.sendMessage(`${color.error}移动假人失败: ${e?.message ?? e}`);
    }
  });
}
