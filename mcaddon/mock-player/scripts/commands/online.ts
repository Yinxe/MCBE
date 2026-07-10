// ─── /mp:online — 上线模拟玩家 ────────────────────────

import { system, Player, CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { botRegistry, loadBotRecord } from "../features/persistence";
import { onlineBot } from "../features/operations";

export function registerOnlineCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:online",
      description: "将一个已创建的假人上线并恢复所有状态",
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
        const record = botRegistry.get(targetName) ?? loadBotRecord(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }
        if (record.online) {
          player.sendMessage(`§e假人 §e${targetName}§e 已经在线`);
          return;
        }
        try {
          onlineBot(record);
          player.sendMessage(`§a假人 §e${record.name}§a 已上线`);
        } catch (e: any) {
          player.sendMessage(`§c假人上线失败: ${e.message}`);
        }
      });
      return { status: CustomCommandStatus.Success, message: `§a正在上线假人 §e${targetName}...` };
    }
  );
}
