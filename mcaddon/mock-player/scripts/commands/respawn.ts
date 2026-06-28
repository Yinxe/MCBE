// ─── /mp:respawn / /mp:setRespawn — 重生管理 ─────────

import { system, world, Player, CustomCommandStatus, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { TAG_RESPAWN, TAG_BOT } from "../features/tags";
import { getPlayerLookTarget } from "../features/utils";
import { botRegistry, saveBotRecord } from "../features/persistence";
import { syncEntityTags } from "../features/tags";

/** /mp:respawn — 切换自动重生标签 */
export function registerRespawnCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:respawn",
      description: "切换假人的自动重生标签（死亡时自动复活）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "请指定假人名字" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }

        const hasTag = record.tags.includes(TAG_RESPAWN.value);
        if (hasTag) {
          record.tags = record.tags.filter((t) => t !== TAG_RESPAWN.value);
          player.sendMessage(`§e假人 §e${record.name}§e 已关闭自动重生，死亡后将下线`);
        } else {
          record.tags.push(TAG_RESPAWN.value);
          player.sendMessage(`§a假人 §e${record.name}§a 已开启自动重生`);
        }

        if (record.online) {
          const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
          if (entity) syncEntityTags(entity, record.tags);
        }
        botRegistry.set(record.name, record);
        saveBotRecord(record);
      });
      return { status: CustomCommandStatus.Success, message: `§a正在切换假人 §e${targetName}§a 的重生标签...` };
    }
  );
}

/** /mp:setRespawn — 设置重生点到玩家位置 */
export function registerSetRespawnCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:setrespawn",
      description: "将假人的重生点设为玩家当前位置和姿态",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin: any, ...args: any[]) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "请指定假人名字" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) { player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`); return; }
        const lookTarget = getPlayerLookTarget(player);
        record.respawnPoint = {
          location: player.location,
          dimension: player.dimension.id,
          rotation: player.getRotation(),
          lookTarget,
        };
        // 同步设置实体出生点，确保 bot.respawn() 在正确位置复活
        if (record.online && record.entityId) {
          const bot = world.getEntity(record.entityId);
          if (bot && bot.hasTag(TAG_BOT.value)) {
            (bot as Player).setSpawnPoint({
              dimension: world.getDimension(record.respawnPoint.dimension),
              x: record.respawnPoint.location.x,
              y: record.respawnPoint.location.y,
              z: record.respawnPoint.location.z,
            });
          }
        }
        botRegistry.set(record.name, record);
        saveBotRecord(record);
        player.sendMessage(`§a已更新假人 §e${record.name}§a 的重生点到当前位置`);
      });
      return { status: CustomCommandStatus.Success, message: "§a正在设置重生点..." };
    }
  );
}
