// ─── /mp:delete — 删除模拟玩家 ────────────────────────

import { system, Player, CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { botRegistry } from "../features/persistence";
import { deleteBot } from "../features/operations";

export function registerDeleteCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:delete",
      description: "删除指定假人",
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
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }
        try {
          deleteBot(record, player);
          player.sendMessage(`§a已删除假人 §e${targetName}，物品和经验已回收`);
        } catch (e: any) {
          player.sendMessage(`§c删除假人失败: ${e.message}`);
        }
      });
      return { status: CustomCommandStatus.Success, message: `§a正在删除假人 §e${targetName}...` };
    }
  );
}
