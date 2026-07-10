// ─── /mp:control — 控制模式 ──────────────────────────

import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { TAG_CONTROL } from "../features/core/tags";
import { botRegistry } from "../features/core/persistence";
import { toggleControl } from "../features/control";

export function registerControlCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:control",
    description: "体态控制：开启后假人持续跟随玩家位置/朝向/视角",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [{ name: "enable", type: CustomCommandParamType.Boolean }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c用法: /mp:control <假人> [true|false]"); return; }

    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }

    const turnOn = (params.enable as boolean | undefined) ?? true;
    const isOn = record.tags.includes(TAG_CONTROL.value);
    if (turnOn && !isOn) { toggleControl(record, player); player.sendMessage(`§a已开启假人 §e${targetName}§a 的体态控制`); }
    else if (!turnOn && isOn) { toggleControl(record, player); player.sendMessage(`§e已关闭假人 §e${targetName}§e 的体态控制，体态固定`); }
    else { player.sendMessage(turnOn ? `§e假人 §e${targetName}§e 已处于控制模式` : `§e假人 §e${targetName}§e 未处于控制模式`); }
  });
}
