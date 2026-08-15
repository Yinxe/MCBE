import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { resolveBotForCommand } from "./auth";

export function registerFollowCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:follow",
    description: "让假人跟随/停止跟随目标玩家",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const botName = params.name as string;
    const bot = resolveBotForCommand(player, botName);
    if (!bot) return;

    if (bot.isFollowing) {
      // 已跟随 → 停止跟随
      bot.unfollow();
      player.sendMessage(`${color.success}已停止 ${color.playerName}${botName}${color.success} 的跟随`);
    } else {
      // 未跟随 → 开始跟随
      if (!bot.isAvailable) { player.sendMessage(`${color.error}假人不在线或已死亡`); return; }
      const ok = bot.follow(player.id);
      if (ok) {
        player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 正在跟随你`);
      } else {
        player.sendMessage(`${color.error}启动跟随失败`);
      }
    }
  });
}
