import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { resolveBotForCommand } from "./auth";
export function registerReclaimCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:reclaim", description: "回收假人全部背包装备和经验到玩家",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}用法: /mp:reclaim <假人名>`); return; }
    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;
    try {
      const r = bot.reclaim(player);
      const parts = [];
      if (r.items > 0) parts.push(`${color.success}${r.items}${color.muted} 件物品`);
      if (r.overflow > 0) parts.push(`${color.playerName}${r.overflow}${color.muted} 件溢出掉落`);
      if (r.xp > 0) parts.push(`${color.accent}${r.xp} XP${color.muted}（Lv.${r.xpLevel}）`);
      player.sendMessage(parts.length ? `${color.success}已从 ${color.playerName}${targetName}${color.success} 回收: ${parts.join("、")}` : `${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 背包是空的`);
    } catch (e: any) {
      player.sendMessage(`${color.error}回收失败: ${e?.message ?? e}`);
    }
  });
}
