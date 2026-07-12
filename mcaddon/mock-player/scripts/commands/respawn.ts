import { world, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { TAG_RESPAWN, TAG_BOT } from "../features/core/tags";
import { botRegistry, saveBotRecord } from "../features/core/persistence";
import { setTags } from "../features/setTags";
import { getPlayerLookTarget } from "../features/core/utils";
export function registerRespawnCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:respawn", description: "切换假人的自动重生标签",
    cheatsRequired: false, permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  }, ({ player, params }) => {
    const targetName = params.name as string;
    if (!targetName) { player.sendMessage("§c请指定假人名字"); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    const has = record.tags.includes(TAG_RESPAWN.value);
    const newTags = has
      ? record.tags.filter(t => t !== TAG_RESPAWN.value)
      : [...record.tags, TAG_RESPAWN.value];
    setTags(record, newTags);
    player.sendMessage(has
      ? `§e假人 §e${record.name}§e 已关闭自动重生`
      : `§a假人 §e${record.name}§a 已开启自动重生`);
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
    if (!targetName) { player.sendMessage("§c请指定假人名字"); return; }
    const record = botRegistry.get(targetName);
    if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
    const lookTarget = getPlayerLookTarget(player);
    record.respawnPoint = { location: player.location, dimension: player.dimension.id, rotation: player.getRotation(), lookTarget };
    if (record.online && record.entityId) {
      const e = world.getEntity(record.entityId);
      if (e?.hasTag(TAG_BOT.value)) {
        (e as any).setSpawnPoint({ dimension: world.getDimension(record.respawnPoint.dimension), x: record.respawnPoint.location.x, y: record.respawnPoint.location.y, z: record.respawnPoint.location.z });
      }
    }
    botRegistry.set(record.name, record);
    saveBotRecord(record);
    player.sendMessage(`§a已更新 §e${targetName}§a 的重生点`);
  });
}
