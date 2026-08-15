import { world, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { TAG_RESPAWN, TAG_BOT } from "../rules/BotTags";
import { saveCoordinator } from "../bootstrap/context";
import { resolveBotForCommand } from "./auth";
import { setTags } from "../features/state/setTags";
import { getPlayerLookTarget } from "../features/basic/PoseGateway";
export function registerRespawnCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:respawn", description: "切换假人的自动重生标签",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}请指定假人名字`); return; }
    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;
    const has = bot.hasTag(TAG_RESPAWN.value);
    const newTags = has
      ? bot.tags.filter(t => t !== TAG_RESPAWN.value)
      : [...bot.tags, TAG_RESPAWN.value];
    const rejected = setTags(bot.record, newTags);
    if (rejected) { player.sendMessage(`${color.error}${rejected}`); return; }
    player.sendMessage(has
      ? `${color.playerName}假人 ${color.playerName}${bot.name}${color.playerName} 已关闭自动重生`
      : `${color.success}假人 ${color.playerName}${bot.name}${color.success} 已开启自动重生`);
  });
}

/** /mp:setRespawn — 设置重生点到玩家位置 */
export function registerSetRespawnCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:setrespawn",
    description: "将假人的重生点设为玩家当前位置和姿态",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}请指定假人名字`); return; }
    const bot = resolveBotForCommand(player, targetName);
    if (!bot) return;
    const lookTarget = getPlayerLookTarget(player);
    bot.record.respawnPoint = { location: player.location, dimension: player.dimension.id, rotation: player.getRotation(), lookTarget };
    try {
      if (bot.record.online && bot.record.entityId) {
        const e = world.getEntity(bot.record.entityId);
        if (e?.hasTag(TAG_BOT.value)) {
          (e as any).setSpawnPoint({ dimension: world.getDimension(bot.record.respawnPoint.dimension), x: bot.record.respawnPoint.location.x, y: bot.record.respawnPoint.location.y, z: bot.record.respawnPoint.location.z });
        }
      }
    } catch (e: any) {
      console.warn(`[MockPlayer] setSpawnPoint 失败 ${bot.name}: ${e?.message ?? e}`);
    }
    saveCoordinator.saveRecord(bot.record);
    player.sendMessage(`${color.success}已更新 ${color.playerName}${targetName}${color.success} 的重生点`);
  });
}
