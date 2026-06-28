import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, GameMode, StartupEvent, Player, Vector3, Vector2 } from "@minecraft/server";
import { spawnSimulatedPlayer, LookDuration } from "@minecraft/server-gametest";

// 假人名称自动增长计数器
let botCounter = 1;

/**
 * 将欧拉角（pitch/yaw）转换为朝向单位向量
 */
function rotationToDirection(rotation: Vector2): Vector3 {
  const pitchRad = (rotation.x * Math.PI) / 180;
  const yawRad = (rotation.y * Math.PI) / 180;
  return {
    x: -Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad),
  };
}

/**
 * 计算玩家视角的目标位置：
 * - 如果玩家看向方块，使用被击中方块的中心
 * - 如果看向天空/远处，沿视角方向推算一个远距离点
 */
function getPlayerLookTarget(player: Player, maxDistance: number = 64): Vector3 {
  const blockHit = player.getBlockFromViewDirection({ maxDistance });

  if (blockHit) {
    const block = blockHit.block;
    return {
      x: block.location.x + 0.5,
      y: block.location.y + 0.5,
      z: block.location.z + 0.5,
    };
  }

  // 没有击中任何方块，沿视角方向计算远距离位置
  const headLoc = player.getHeadLocation();
  const dir = rotationToDirection(player.getRotation());
  return {
    x: headLoc.x + dir.x * maxDistance,
    y: headLoc.y + dir.y * maxDistance,
    z: headLoc.z + dir.z * maxDistance,
  };
}

// 注册自定义命令（必须在 early-execution mode 中执行）
system.beforeEvents.startup.subscribe((event: StartupEvent) => {
  const registry = event.customCommandRegistry;

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
    (origin, ...args) => {
      // 解析可选参数
      const userName = args[0] as string | undefined;
      const userLocation = args[1] as { x: number; y: number; z: number } | undefined;
      const dimensionName = args[2] as string | undefined;

      // 命令必须由实体（玩家）执行
      if (!origin.sourceEntity) {
        return {
          status: CustomCommandStatus.Failure,
          message: "该命令只能由玩家执行",
        };
      }

      const player = origin.sourceEntity as Player;

      // 生成假人名称：用户指定或自动递增
      const botName = userName || `Bot${botCounter++}`;

      // 确定位置：用户指定或获取玩家当前位置
      const pos = userLocation ?? player.location;

      // 确定维度：用户指定或获取玩家当前维度
      const dimension = dimensionName
        ? world.getDimension(dimensionName)
        : player.dimension;

      // spawnSimulatedPlayer 不能在受限执行模式中调用，
      // 需要用 system.run 推迟到主 tick 执行
      system.run(() => {
        try {
          // spawnSimulatedPlayer 无视坐标永远生成在西北角，
          // 需要先创建假人再用 teleport 修正位置
          const bot = spawnSimulatedPlayer(
            { x: pos.x, y: pos.y, z: pos.z, dimension },
            botName,
            GameMode.Survival,
          );

          // 1. 传送修正位置 + 设置与玩家相同的朝向
          bot.teleport(
            { x: pos.x, y: pos.y, z: pos.z },
            { rotation: player.getRotation() },
          );

          // 2. 同步潜行状态
          bot.isSneaking = player.isSneaking;

          // 3. 假人看向玩家正在看的位置
          const lookTarget = getPlayerLookTarget(player);
          bot.lookAtLocation(lookTarget, LookDuration.Continuous);

          player.sendMessage(`§a成功创建假人 §e${botName}`);
        } catch (e: any) {
          player.sendMessage(`§c创建假人失败: ${e.message}`);
        }
      });

      return {
        status: CustomCommandStatus.Success,
        message: `§a正在创建假人 §e${botName}...`,
      };
    },
  );
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.initialSpawn) {
    world.sendMessage("HELLO WORLD");
  }
});

function mainTick() {

  // add main loop code here.
  system.run(mainTick);
}

// Uncomment the line below to ensure your main tick code is called from the start.
// system.run(mainTick);
