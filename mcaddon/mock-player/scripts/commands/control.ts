// ─── /mp:control — 控制模式 ──────────────────────────

import { system, Player, CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { TAG_CONTROL } from "../features/tags";
import { botRegistry } from "../features/persistence";
import { toggleControl } from "../features/operations";

export function registerControlCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:control",
      description: "体态控制：开启后假人持续跟随玩家位置/朝向/视角",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "enable", type: CustomCommandParamType.Boolean }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      const enable = args[1] as boolean | undefined;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "用法: /mp:control <假人> [true|false]" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }

        const turnOn = enable ?? true;
        // 只在状态需要变更时才调用 toggleControl
        const isOn = record.tags.includes(TAG_CONTROL.value);
        if (turnOn && !isOn) {
          toggleControl(record, player);
          player.sendMessage(`§a已开启假人 §e${targetName}§a 的体态控制`);
        } else if (!turnOn && isOn) {
          toggleControl(record, player);
          player.sendMessage(`§e已关闭假人 §e${targetName}§e 的体态控制，体态固定`);
        } else {
          player.sendMessage(
            turnOn ? `§e假人 §e${targetName}§e 已处于控制模式` : `§e假人 §e${targetName}§e 未处于控制模式`
          );
        }
        // toggleControl 已处理持久化和标签同步
      });
      return { status: CustomCommandStatus.Success, message: "§a正在处理体态控制..." };
    }
  );
}
