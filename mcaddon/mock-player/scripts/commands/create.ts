import { system, world, Vector3 } from "@minecraft/server";
import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { TAG_BOT, TAG_RESPAWN, TAG_IDLE, DEFAULT_TAGS } from "../features/core/tags";
import { getPlayerLookTarget } from "../features/core/pose";
import { generateBotName } from "../features/core/persistence";
import { createBot } from "../features/createBot";

export function registerCreateCommand(registry: any): void {
  defineCommand(registry, {
    name: "mp:create",
    description: "创建一个模拟玩家（假人）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { name: "name", type: CustomCommandParamType.String },
      { name: "location", type: CustomCommandParamType.Location },
      { name: "dimension", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    system.run(() => {
      const botName = (params.name as string) || generateBotName();
      const pos = (params.location as Vector3 | undefined) ?? player.location;
      const dimension = params.dimension ? world.getDimension(params.dimension as string) : player.dimension;
      const playerRot = player.getRotation();
      const lookTarget = getPlayerLookTarget(player);
      createBot({
        name: botName, location: pos, dimension,
        initialTags: DEFAULT_TAGS,
        rotation: { x: playerRot.x, y: playerRot.y, z: 0 },
        lookTarget, isSneaking: player.isSneaking,
        spawnMode: "normal",
      });
      player.sendMessage(`${color.success}成功创建假人 ${color.playerName}${botName}${color.accent} [自动重生]`);
    });
  });
}
