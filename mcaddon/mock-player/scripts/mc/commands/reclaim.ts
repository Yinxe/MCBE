import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry } from "../bootstrap/context";
import { guardBotCommand } from "./auth";
import { reclaimBot } from "../features/reclaim";
export function registerReclaimCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:reclaim", description: "回收假人全部背包装备和经验到玩家",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}用法: /mp:reclaim <假人名>`); return; }
    const denied = guardBotCommand(player, targetName);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`); return; }
    const r = reclaimBot(player, record);
    const parts = [];
    if (r.items > 0) parts.push(`${color.success}${r.items}${color.muted} 件物品`);
    if (r.overflow > 0) parts.push(`${color.playerName}${r.overflow}${color.muted} 件溢出掉落`);
    if (r.xp > 0) parts.push(`${color.accent}${r.xp} XP${color.muted}（Lv.${r.xpLevel}）`);
    player.sendMessage(parts.length ? `${color.success}已从 ${color.playerName}${targetName}${color.success} 回收: ${parts.join("、")}` : `${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 背包是空的`);
  });
}
