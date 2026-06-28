import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, GameMode, StartupEvent, Player, Vector3, Vector2 } from "@minecraft/server";
import { spawnSimulatedPlayer, LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

// ─── 假人标识与状态管理 ───────────────────────────────

const BOT_TAG = "mp:bot";

/** 假人记录 */
interface BotRecord {
  /** 玩家名 */
  name: string;
  /** 是否在线（连接/加载到世界中） */
  online: boolean;
  /** 是否死亡 */
  death: boolean;
  /** 最后已知位置 */
  lastLocation: Vector3;
  /** 最后已知维度 ID（如 "minecraft:overworld"） */
  lastDimension: string;
}

/** 所有已创建的假人，key = 玩家名 */
const botRegistry: Map<string, BotRecord> = new Map();

// 假人名称自动增长计数器
let botCounter = 1;

// ─── 工具函数 ──────────────────────────────────────────

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

/**
 * 格式化维度 ID 为简短显示名
 */
function formatDimensionId(dimId: string): string {
  const shortMap: Record<string, string> = {
    "minecraft:overworld": "主世界",
    "minecraft:nether": "下界",
    "minecraft:the_end": "末地",
  };
  return shortMap[dimId] ?? dimId;
}

/**
 * 构建假人列表消息
 */
function buildListMessage(
  records: BotRecord[],
  filterOnline?: boolean,
  filterDeath?: boolean,
): string {
  let filtered = records;

  if (filterOnline !== undefined) {
    filtered = filtered.filter((r) => r.online === filterOnline);
  }
  if (filterDeath !== undefined) {
    filtered = filtered.filter((r) => r.death === filterDeath);
  }

  if (filtered.length === 0) {
    return "§e没有匹配的假人";
  }

  const lines = filtered.map((r) => {
    const statusIcon = r.death ? "§c💀" : r.online ? "§a✔" : "§7❌";
    const statusText = r.death ? "§c死亡" : r.online ? "§a在线" : "§7离线";
    const loc = r.lastLocation;
    const dim = formatDimensionId(r.lastDimension);
    const posStr = `§7[§f${Math.floor(loc.x)} §f${Math.floor(loc.y)} §f${Math.floor(loc.z)}§7] §8${dim}`;
    return `${statusIcon} §e${r.name}§7 — ${statusText} §7| ${posStr}`;
  });

  lines.unshift(`§a假人列表 (§b${filtered.length}§a/${records.length}§a):`);
  return lines.join("\n");
}

// ─── 自定义命令注册（必须在 early-execution mode 中执行） ──

system.beforeEvents.startup.subscribe((event: StartupEvent) => {
  const registry = event.customCommandRegistry;

  // ── /mp:create ──────────────────────────────────────
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

          // 3. 标记假人身份
          bot.addTag(BOT_TAG);

          // 4. 假人看向玩家正在看的位置
          const lookTarget = getPlayerLookTarget(player);
          bot.lookAtLocation(lookTarget, LookDuration.Continuous);

          // 5. 注册到假人管理器
          botRegistry.set(botName, {
            name: botName,
            online: true,
            death: false,
            lastLocation: { x: pos.x, y: pos.y, z: pos.z },
            lastDimension: dimension.id,
          });

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

  // ── /mp:list [online] [death] ──────────────────────
  registry.registerCommand(
    {
      name: "mp:list",
      description: "列出所有已创建的假人（可按在线/死亡状态筛选）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "online", type: CustomCommandParamType.Boolean },
        { name: "death", type: CustomCommandParamType.Boolean },
      ],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) {
        return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      }

      const player = origin.sourceEntity as Player;
      const filterOnline = args[0] as boolean | undefined;
      const filterDeath = args[1] as boolean | undefined;

      system.run(() => {
        // 刷新在线假人的最新位置
        const onlineBots = world.getPlayers({ tags: [BOT_TAG] });
        for (const bot of onlineBots) {
          const record = botRegistry.get(bot.name);
          if (record) {
            record.lastLocation = bot.location;
            record.lastDimension = bot.dimension.id;
          }
        }

        const records = Array.from(botRegistry.values());
        const message = buildListMessage(records, filterOnline, filterDeath);
        player.sendMessage(message);
      });

      return { status: CustomCommandStatus.Success, message: "§a正在查询假人列表..." };
    },
  );

  // ── /mp:delete <name> ──────────────────────────────
  registry.registerCommand(
    {
      name: "mp:delete",
      description: "删除指定假人",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        { name: "name", type: CustomCommandParamType.String },
      ],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) {
        return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      }

      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      if (!targetName) {
        return { status: CustomCommandStatus.Failure, message: "请指定要删除的假人名字" };
      }

      system.run(() => {
        // 尝试从世界中查找在线假人
        const bots = world.getPlayers({ tags: [BOT_TAG] });
        const target = bots.find((b: Player) => b.name === targetName);

        if (target) {
          try {
            (target as SimulatedPlayer).disconnect();
            botRegistry.delete(targetName);
            player.sendMessage(`§a已删除假人 §e${targetName}`);
            return;
          } catch (e: any) {
            player.sendMessage(`§c删除假人失败: ${e.message}`);
            return;
          }
        }

        // 在线中找不到，但 registry 中还有记录（已离线/死亡未清理）
        if (botRegistry.has(targetName)) {
          botRegistry.delete(targetName);
          player.sendMessage(`§a已从记录中移除假人 §e${targetName}§7（不在世界中）`);
          return;
        }

        player.sendMessage(`§c未找到假人 §e${targetName}`);
      });

      return { status: CustomCommandStatus.Success, message: `§a正在删除假人 §e${targetName}...` };
    },
  );
});

// ─── 假人状态事件监听 ──────────────────────────────────

// 假人死亡 → death = true，更新最后位置
world.afterEvents.entityDie.subscribe((event) => {
  const entity = event.deadEntity;
  if (!entity.hasTag(BOT_TAG)) return;

  const name = entity.nameTag;
  const record = botRegistry.get(name);
  if (record) {
    record.death = true;
    record.lastLocation = entity.location;
    record.lastDimension = entity.dimension.id;
  }
});

// 假人重生（非首次加入）→ death = false, online = true
world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;

  // 首次登录由 playerJoin 处理，这里只处理重生
  if (event.initialSpawn) return;
  if (!player.hasTag(BOT_TAG)) return;

  const record = botRegistry.get(player.name);
  if (record) {
    record.death = false;
    record.online = true;
  }
});

// 假人加入世界 → online = true
world.afterEvents.playerJoin.subscribe((event) => {
  const record = botRegistry.get(event.playerName);
  if (record) {
    record.online = true;
  }
});

// 假人离开世界 → online = false，更新最后位置
world.afterEvents.playerLeave.subscribe((event) => {
  const record = botRegistry.get(event.playerName);
  if (record) {
    record.online = false;
    // playerLeave 没有提供 Player 对象，无法获取最新位置，
    // 保留 registry 中最后的已知位置即可
  }
});
