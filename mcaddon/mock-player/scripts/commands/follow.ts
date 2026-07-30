import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { botRegistry } from "../features/core/persistence";
import { startFollow, stopFollow, isFollowing } from "../features/follow";

export function registerFollowCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:follow",
    description: "让假人跟随/停止跟随目标玩家",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const botName = params.name as string;
    if (!botName) { player.sendMessage("§c用法: /mp:follow <假人>"); return; }
    const record = botRegistry.get(botName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${botName}§c 的记录`); return; }

    if (isFollowing(botName)) {
      // 已跟随 → 停止跟随
      stopFollow(botName);
      player.sendMessage(`§a已停止 §e${botName}§a 的跟随`);
    } else {
      // 未跟随 → 开始跟随
      if (!record.online || record.death) { player.sendMessage("§c假人不在线或已死亡"); return; }
      const ok = startFollow(botName, player.id);
      if (ok) {
        player.sendMessage(`§a§e${botName}§a 正在跟随你`);
      } else {
        player.sendMessage(`§c启动跟随失败`);
      }
    }
  });
}
