import { world, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { TAG_RESPAWN, TAG_BOT } from "../../core/tags/BotTags";
import { botRegistry } from "../bootstrap/context";
import { guardBotCommand } from "./auth";
import { setTags } from "../features/setTags";
import { getPlayerLookTarget } from "../adapters/PoseGateway";
export function registerRespawnCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:respawn", description: "切换假人的自动重生标签",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage(`${color.error}请指定假人名字`); return; }
    const denied = guardBotCommand(player, targetName);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`); return; }
    const has = record.tags.includes(TAG_RESPAWN.value);
    const newTags = has
      ? record.tags.filter(t => t !== TAG_RESPAWN.value)
      : [...record.tags, TAG_RESPAWN.value];
    setTags(record, newTags);
    player.sendMessage(has
      ? `${color.playerName}假人 ${color.playerName}${record.name}${color.playerName} 已关闭自动重生`
      : `${color.success}假人 ${color.playerName}${record.name}${color.success} 已开启自动重生`);
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
    const denied = guardBotCommand(player, targetName);
    if (denied) { player.sendMessage(`${color.error}${denied}`); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`); return; }
    const lookTarget = getPlayerLookTarget(player);
    record.respawnPoint = { location: player.location, dimension: player.dimension.id, rotation: player.getRotation(), lookTarget };
    if (record.online && record.entityId) {
      const e = world.getEntity(record.entityId);
      if (e?.hasTag(TAG_BOT.value)) {
        (e as any).setSpawnPoint({ dimension: world.getDimension(record.respawnPoint.dimension), x: record.respawnPoint.location.x, y: record.respawnPoint.location.y, z: record.respawnPoint.location.z });
      }
    }
    botRegistry.save(record);
    player.sendMessage(`${color.success}已更新 ${color.playerName}${targetName}${color.success} 的重生点`);
  });
}
