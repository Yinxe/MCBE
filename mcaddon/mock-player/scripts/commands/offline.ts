// ─── /mp:offline — 下线模拟玩家 ───────────────────────

import { system, Player, CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { botRegistry } from "../features/persistence";
import { offlineBot } from "../features/operations";

export function registerOfflineCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:offline",
      description: "将假人下线，保留所有状态记录",
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
        if (!record.online) { player.sendMessage(`§e假人 §e${targetName}§e 已经离线`); return; }
        try {
          offlineBot(record);
          player.sendMessage(`§a假人 §e${record.name}§a 已下线`);
        } catch (e: any) {
          player.sendMessage(`§c假人下线失败: ${e.message}`);
        }
      });
      return { status: CustomCommandStatus.Success, message: `§a正在下线假人 §e${targetName}...` };
    }
  );
}
