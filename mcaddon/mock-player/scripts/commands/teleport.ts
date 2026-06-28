// ─── /mp:tp / /mp:tphere — 传送管理 ──────────────────

import { system, world, Player, CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { botRegistry } from "../features/persistence";
import { tpPlayerToBot, tpBotToPlayer } from "../features/operations";

/** /mp:tp — 传送到假人身边 */
export function registerTpCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:tp",
      description: "传送到假人身边（假人必须在线且存活）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "请指定假人名字" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
        try {
          tpPlayerToBot(player, record);
          player.sendMessage(`§a已传送到假人 §e${targetName}§a 身边`);
        } catch (e: any) {
          player.sendMessage(`§c传送失败: ${e.message}`);
        }
      });
      return { status: CustomCommandStatus.Success, message: "§a正在传送..." };
    }
  );
}

/** /mp:tphere — 传送到玩家身边 */
export function registerTpHereCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:tphere",
      description: "让假人传送到玩家身边（假人必须在线且存活）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "请指定假人名字" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
        try {
          tpBotToPlayer(record, player);
          player.sendMessage(`§a已将假人 §e${targetName}§a 传送到身边`);
        } catch (e: any) {
          player.sendMessage(`§c传送失败: ${e.message}`);
        }
      });
      return { status: CustomCommandStatus.Success, message: "§a正在传送假人..." };
    }
  );
}
