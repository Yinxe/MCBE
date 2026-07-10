// ─── /mp:sneak — 潜行切换 ────────────────────────────

import { Player, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry } from "../features/persistence";
import { setSneaking } from "../features/operations";

export function registerSneakCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:sneak",
    description: "设置假人的潜行状态",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [{ name: "sneak", type: CustomCommandParamType.Boolean }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) {
      player.sendMessage("§c用法: /mp:sneak <假人> [true|false]");
      return;
    }
    const record = botRegistry.get(targetName);
    if (!record) {
      player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
      return;
    }
    const shouldSneak = params.sneak !== undefined ? (params.sneak as boolean) : true;
    setSneaking(record, shouldSneak);
    player.sendMessage(shouldSneak ? `§a假人 §e${targetName}§a 已潜行` : `§a假人 §e${targetName}§a 已站起`);
  });
}
