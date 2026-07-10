// ─── /mp:sneak — 潜行切换 ────────────────────────────

import { system, Player, CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { botRegistry } from "../features/persistence";
import { setSneaking } from "../features/operations";

export function registerSneakCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:sneak",
      description: "设置假人的潜行状态",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "sneak", type: CustomCommandParamType.Boolean }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      const sneak = args[1] as boolean | undefined;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "用法: /mp:sneak <假人> [true|false]" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }
        const shouldSneak = sneak ?? true;
        setSneaking(record, shouldSneak);
        player.sendMessage(shouldSneak ? `§a假人 §e${targetName}§a 已潜行` : `§a假人 §e${targetName}§a 已站起`);
      });
      return { status: CustomCommandStatus.Success, message: "§a正在设置潜行..." };
    }
  );
}
