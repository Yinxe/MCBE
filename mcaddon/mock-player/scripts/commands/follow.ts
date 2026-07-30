import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
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
    const record = botRegistry.get(botName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${botName}${color.error} 的记录`); return; }

    if (isFollowing(botName)) {
      // 已跟随 → 停止跟随
      stopFollow(botName);
      player.sendMessage(`${color.success}已停止 ${color.playerName}${botName}${color.success} 的跟随`);
    } else {
      // 未跟随 → 开始跟随
      if (!record.online || record.death) { player.sendMessage(`${color.error}假人不在线或已死亡`); return; }
      const ok = startFollow(botName, player.id);
      if (ok) {
        player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 正在跟随你`);
      } else {
        player.sendMessage(`${color.error}启动跟随失败`);
      }
    }
  });
}
