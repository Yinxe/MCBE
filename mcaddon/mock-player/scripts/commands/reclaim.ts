import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry } from "../features/persistence";
import { reclaimBot } from "../features/operations";
export function registerReclaimCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:reclaim", description: "回收假人全部背包装备和经验到玩家",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c用法: /mp:reclaim <假人名>"); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    const r = reclaimBot(player, record);
    const parts = [];
    if (r.items > 0) parts.push(`§a${r.items}§7 件物品`);
    if (r.overflow > 0) parts.push(`§e${r.overflow}§7 件溢出掉落`);
    if (r.xp > 0) parts.push(`§b${r.xp} XP§7（Lv.${r.xpLevel}）`);
    player.sendMessage(parts.length ? `§a已从 §e${targetName}§a 回收: ${parts.join("、")}` : `§e假人 §e${targetName}§e 背包是空的`);
  });
}
