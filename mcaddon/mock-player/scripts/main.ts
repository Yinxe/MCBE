import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, GameMode, StartupEvent, Player } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";

// 假人名称自动增长计数器
let botCounter = 1;

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
          spawnSimulatedPlayer(
            { x: pos.x, y: pos.y, z: pos.z, dimension },
            botName,
            GameMode.Survival,
          );
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
