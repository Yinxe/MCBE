import { world, Vector3 } from "@minecraft/server";
import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { TAG_BOT, TAG_RESPAWN, TAG_IDLE, DEFAULT_TAGS } from "../features/tags";
import { getPlayerLookTarget } from "../features/utils";
import { generateBotName } from "../features/persistence";
import { createBot } from "../features/operations";

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
    });
    player.sendMessage(`§a成功创建假人 §e${botName}§b [自动重生]`);
  });
}
