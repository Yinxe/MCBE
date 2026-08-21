import { Vector3, system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { NavigateResult } from "../../../features/basic/move";
import { resolveBotForCommand } from "../auth";

/** 导航结果 → 玩家消息（多状态，各自说明失败原因） */
function navigateMessage(targetName: string, loc: Vector3, result: NavigateResult, nearby = false): string {
  const pos = `${color.playerName}${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}`;
  switch (result) {
    case NavigateResult.Arrived:
      return nearby
        ? `${color.success}假人 ${color.playerName}${targetName}${color.success} 已在目标点附近停下（nearby=true，视为到达）${pos}`
        : `${color.success}假人 ${color.playerName}${targetName}${color.success} 已到达 ${pos}`;
    case NavigateResult.TooFar:
      return `${color.warn}假人 ${color.playerName}${targetName}${color.warn} 拒绝寻路：目标 ${pos} 超出最远距离（>16 格）`;
    case NavigateResult.NoPath:
      return `${color.warn}假人 ${color.playerName}${targetName}${color.warn} 无法到达 ${pos}：无路径可达（障碍/距离过远）`;
    case NavigateResult.StillTimeout:
      return `${color.warn}假人 ${color.playerName}${targetName}${color.warn} 移动超时：0.5 秒内位置未变化（可能卡住）`;
    case NavigateResult.Timeout:
      return `${color.warn}假人 ${color.playerName}${targetName}${color.warn} 30 秒未到达 ${pos}（仍在移动或路径过长）`;
    case NavigateResult.Unavailable:
      return `${color.error}假人 ${color.playerName}${targetName}${color.error} 不可用（不在线或已死亡）`;
    case NavigateResult.EntityInvalid:
      return `${color.error}假人 ${color.playerName}${targetName}${color.error} 移动中实体失效（死亡/下线）`;
    default:
      return `${color.error}移动假人 ${color.playerName}${targetName}${color.error} 失败（异常）`;
  }
}

export function registerMoveCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:move", description: "让模拟玩家自动寻路到指定坐标（nearby=true 目标点附近停下也算到达）",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [
      { name: "location", type: CustomCommandParamType.Location },
      { name: "nearby", type: CustomCommandParamType.Boolean },
    ],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}用法: /mp:move <假人> [x] [y] [z] [nearby]`); return; }
    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;
    const loc = (params.location as Vector3 | undefined) ?? player.location;
    const nearby = (params.nearby as boolean | undefined) ?? false;
    // 异步等待完成（navigateBot 内 while+await 每 10tick 监测位置，命令不阻塞主线程）
    system.run(async () => {
      const result = await bot.navigateTo(loc, undefined, undefined, nearby);
      player.sendMessage(navigateMessage(targetName, loc, result, nearby));
    });
  });
}

export function registerLongMoveCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:longmove", description: "让模拟玩家长途寻路到指定坐标（分段接力，可远超 16 格，段间零间停；nearby=true 目标点附近停下也算到达）",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    optionalParameters: [
      { name: "location", type: CustomCommandParamType.Location },
      { name: "nearby", type: CustomCommandParamType.Boolean },
    ],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}用法: /mp:longmove <假人> [x] [y] [z] [nearby]`); return; }
    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;
    const loc = (params.location as Vector3 | undefined) ?? player.location;
    const nearby = (params.nearby as boolean | undefined) ?? false;
    system.run(async () => {
      const result = await bot.navigateLongTo(loc, undefined, undefined, nearby);
      player.sendMessage(navigateMessage(targetName, loc, result, nearby));
    });
  });
}
