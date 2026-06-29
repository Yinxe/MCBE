// ─── /mp:reclaim — 回收假人物品和经验 ─────────────────

import { system, Player, CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { botRegistry } from "../features/persistence";
import { reclaimBot } from "../features/operations";

export function registerReclaimCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:reclaim",
      description: "回收假人全部背包装备和经验到玩家（溢出掉落在地）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "用法: /mp:reclaim <假人名>" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }

        try {
          const result = reclaimBot(player, record);
          const parts: string[] = [];
          if (result.items > 0) parts.push(`§a${result.items}§7 件物品`);
          if (result.overflow > 0) parts.push(`§e${result.overflow}§7 件溢出掉落`);
          if (result.xp > 0) parts.push(`§b${result.xp} XP§7（Lv.${result.xpLevel}）`);
          if (parts.length === 0) {
            player.sendMessage(`§e假人 §e${targetName}§e 背包是空的`);
          } else {
            player.sendMessage(`§a已从 §e${targetName}§a 回收: ${parts.join("、")}`);
          }
        } catch (e: any) {
          player.sendMessage(`§c回收失败: ${e.message}`);
        }
      });

      return { status: CustomCommandStatus.Success, message: "§a正在回收..." };
    }
  );
}
