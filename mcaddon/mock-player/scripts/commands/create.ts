// ─── /mp:create — 创建模拟玩家 ────────────────────────

import {
  system,
  world,
  Player,
  Vector3,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
} from "@minecraft/server";
import { TAG_BOT, TAG_RESPAWN, TAG_IDLE } from "../features/tags";
import { getPlayerLookTarget } from "../features/utils";
import { generateBotName } from "../features/persistence";
import { createBot } from "../features/operations";

export function registerCreateCommand(registry: any): void {
  registry.registerCommand(
    {
      name: "mp:create",
      description: "创建一个模拟玩家（假人）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "name", type: CustomCommandParamType.String },
        { name: "location", type: CustomCommandParamType.Location },
        { name: "dimension", type: CustomCommandParamType.String },
      ],
    },
    (origin: any, ...args: any[]) => {
      const userName = args[0] as string | undefined;
      const userLocation = args[1] as Vector3 | undefined;
      const dimensionName = args[2] as string | undefined;
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };

      const player = origin.sourceEntity as Player;
      const botName = userName || generateBotName();
      const pos = userLocation ?? player.location;
      const dimension = dimensionName ? world.getDimension(dimensionName) : player.dimension;
      const playerRot = player.getRotation();
      const lookTarget = getPlayerLookTarget(player);

      system.run(() => {
        try {
          createBot({
            name: botName,
            location: pos,
            dimension,
            initialTags: [TAG_BOT.value, TAG_RESPAWN.value, TAG_IDLE.value],
            rotation: { x: playerRot.x, y: playerRot.y, z: 0 },
            lookTarget,
            isSneaking: player.isSneaking,
          });
          player.sendMessage(`§a成功创建假人 §e${botName}§b [自动重生]`);
        } catch (e: any) {
          player.sendMessage(`§c创建假人失败: ${e.message}`);
        }
      });
      return { status: CustomCommandStatus.Success, message: `§a正在创建假人 §e${botName}...` };
    }
  );
}
