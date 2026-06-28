// ─── /mp:move — 移动模拟玩家 ──────────────────────────

import { system, Player, Vector3, CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { botRegistry } from "../features/persistence";
import { moveBot } from "../features/operations";

export function registerMoveCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:move",
      description: "让模拟玩家自动寻路到指定坐标，不填坐标则寻路到玩家位置",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "location", type: CustomCommandParamType.Location }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      const targetLocation = (args[1] as Vector3 | undefined) ?? player.location;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "用法: /mp:move <假人> [x] [y] [z]" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
        try {
          const fullPath = moveBot(record, targetLocation);
          if (!fullPath) {
            player.sendMessage(`§e假人 §e${targetName}§e 无法到达目标位置（路径不完整），但已开始移动`);
          } else {
            player.sendMessage(
              `§a假人 §e${targetName}§a 正在前往 §e${Math.floor(targetLocation.x)} ${Math.floor(targetLocation.y)} ${Math.floor(targetLocation.z)}`
            );
          }
        } catch (e: any) {
          player.sendMessage(`§c假人移动失败: ${e.message}`);
        }
      });
      return { status: CustomCommandStatus.Success, message: `§a正在让假人移动...` };
    }
  );
}
