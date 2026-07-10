import { Vector3, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry } from "../features/persistence";
import { moveBot } from "../features/operations";
export function registerMoveCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:move", description: "让模拟玩家自动寻路到指定坐标",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [{ name: "location", type: CustomCommandParamType.Location }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c用法: /mp:move <假人> [x] [y] [z]"); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    const loc = (params.location as Vector3 | undefined) ?? player.location;
    const ok = moveBot(record, loc);
    player.sendMessage(ok
      ? `§a假人 §e${targetName}§a 正在前往 §e${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`
      : `§e假人 §e${targetName}§e 无法完全到达目标位置，但已开始移动`);
  });
}
