import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, GameMode, StartupEvent, Player, Vector3, Vector2 } from "@minecraft/server";
import { spawnSimulatedPlayer, LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

// ─── 常量 ──────────────────────────────────────────────

const BOT_TAG = "mp:bot";
const DP_PREFIX = "mockplayer:players:";

// ─── 假人记录 ──────────────────────────────────────────

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
  /** 潜行状态 */
  isSneaking: boolean;
  /** 身体旋转（pitch, yaw） */
  rotation: Vector2;
  /** 持续看向的目标位置 */
  lookTarget: Vector3;
}

/** 运行时注册表，key = 玩家名 */
const botRegistry: Map<string, BotRecord> = new Map();

// 假人名称自动增长计数器
let botCounter = 1;

// ─── 动态属性持久化 ────────────────────────────────────

function getDPKey(name: string): string {
  return `${DP_PREFIX}${name}`;
}

/** 保存一个假人记录到动态属性 */
function saveBotRecord(record: BotRecord): void {
  try {
    const json = JSON.stringify(record);
    world.setDynamicProperty(getDPKey(record.name), json);
  } catch (e: any) {
    console.warn(`[MockPlayer] 保存假人 ${record.name} 失败: ${e.message}`);
  }
}

/** 从动态属性加载一个假人记录 */
function loadBotRecord(name: string): BotRecord | undefined {
  const value = world.getDynamicProperty(getDPKey(name));
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as BotRecord;
  } catch {
    return undefined;
  }
}

/** 从动态属性加载所有假人记录 */
function loadAllBotRecords(): BotRecord[] {
  const ids = world.getDynamicPropertyIds();
  const records: BotRecord[] = [];
  for (const id of ids) {
    if (!id.startsWith(DP_PREFIX)) continue;
    const value = world.getDynamicProperty(id);
    if (typeof value !== "string") continue;
    try {
      records.push(JSON.parse(value) as BotRecord);
    } catch {
      // 解析失败，忽略损坏的数据
    }
  }
  return records;
}

/** 删除动态属性中的假人记录 */
function removeBotRecord(name: string): void {
  world.setDynamicProperty(getDPKey(name), undefined);
}

// ─── 工具函数 ──────────────────────────────────────────

function rotationToDirection(rotation: Vector2): Vector3 {
  const pitchRad = (rotation.x * Math.PI) / 180;
  const yawRad = (rotation.y * Math.PI) / 180;
  return {
    x: -Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad),
  };
}

function getPlayerLookTarget(player: Player, maxDistance: number = 64): Vector3 {
  const blockHit = player.getBlockFromViewDirection({ maxDistance });
  if (blockHit) {
    const block = blockHit.block;
    return { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
  }
  const headLoc = player.getHeadLocation();
  const dir = rotationToDirection(player.getRotation());
  return {
    x: headLoc.x + dir.x * maxDistance,
    y: headLoc.y + dir.y * maxDistance,
    z: headLoc.z + dir.z * maxDistance,
  };
}

function formatDimensionId(dimId: string): string {
  const shortMap: Record<string, string> = {
    "minecraft:overworld": "主世界",
    "minecraft:nether": "下界",
    "minecraft:the_end": "末地",
  };
  return shortMap[dimId] ?? dimId;
}

function buildListMessage(records: BotRecord[], filterOnline?: boolean, filterDeath?: boolean): string {
  let filtered = records;
  if (filterOnline !== undefined) filtered = filtered.filter((r) => r.online === filterOnline);
  if (filterDeath !== undefined) filtered = filtered.filter((r) => r.death === filterDeath);
  if (filtered.length === 0) return "§e没有匹配的假人";

  const lines = filtered.map((r) => {
    const statusIcon = r.death ? "§c💀" : r.online ? "§a✔" : "§7❌";
    const statusText = r.death ? "§c死亡" : r.online ? "§a在线" : "§7离线";
    const posStr = `§7[§f${Math.floor(r.lastLocation.x)} §f${Math.floor(r.lastLocation.y)} §f${Math.floor(r.lastLocation.z)}§7] §8${formatDimensionId(r.lastDimension)}`;
    return `${statusIcon} §e${r.name}§7 — ${statusText} §7| ${posStr}`;
  });

  lines.unshift(`§a假人列表 (§b${filtered.length}§a/${records.length}§a):`);
  return lines.join("\n");
}

// ─── 假人恢复 ──────────────────────────────────────────

/** 将已存档的状态恢复到 SimulatedPlayer 上 */
function restoreBotState(bot: SimulatedPlayer, record: BotRecord): void {
  const dim = world.getDimension(record.lastDimension);

  // 传送到正确位置并恢复身体朝向
  bot.teleport(record.lastLocation, { rotation: record.rotation });

  // 恢复潜行
  bot.isSneaking = record.isSneaking;

  // 持续看向存档的目标
  bot.lookAtLocation(record.lookTarget, LookDuration.Continuous);
}

// ─── 自定义命令注册 ────────────────────────────────────

system.beforeEvents.startup.subscribe((event: StartupEvent) => {
  const registry = event.customCommandRegistry;

  // ── /mp:create ────────────────────────────────────
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
      const userName = args[0] as string | undefined;
      const userLocation = args[1] as Vector3 | undefined;
      const dimensionName = args[2] as string | undefined;
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };

      const player = origin.sourceEntity as Player;
      const botName = userName || `Bot${botCounter++}`;
      const pos = userLocation ?? player.location;
      const dimension = dimensionName ? world.getDimension(dimensionName) : player.dimension;
      const playerRot = player.getRotation();
      const lookTarget = getPlayerLookTarget(player);

      system.run(() => {
        try {
          const bot = spawnSimulatedPlayer({ x: pos.x, y: pos.y, z: pos.z, dimension }, botName, GameMode.Survival);
          bot.addTag(BOT_TAG);

          // 应用所有状态
          bot.teleport(pos, { rotation: playerRot });
          bot.isSneaking = player.isSneaking;
          bot.lookAtLocation(lookTarget, LookDuration.Continuous);

          // 持久化记录
          const record: BotRecord = {
            name: botName,
            online: true,
            death: false,
            lastLocation: pos,
            lastDimension: dimension.id,
            isSneaking: player.isSneaking,
            rotation: playerRot,
            lookTarget,
          };
          botRegistry.set(botName, record);
          saveBotRecord(record);

          player.sendMessage(`§a成功创建假人 §e${botName}`);
        } catch (e: any) {
          player.sendMessage(`§c创建假人失败: ${e.message}`);
        }
      });

      return { status: CustomCommandStatus.Success, message: `§a正在创建假人 §e${botName}...` };
    },
  );

  // ── /mp:list [online] [death] ────────────────────
  registry.registerCommand(
    {
      name: "mp:list",
      description: "列出所有已创建的假人（可按在线/死亡筛选）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [
        { name: "online", type: CustomCommandParamType.Boolean },
        { name: "death", type: CustomCommandParamType.Boolean },
      ],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const filterOnline = args[0] as boolean | undefined;
      const filterDeath = args[1] as boolean | undefined;

      system.run(() => {
        // 刷新在线假人的最新位置
        for (const bot of world.getPlayers({ tags: [BOT_TAG] })) {
          const record = botRegistry.get(bot.name);
          if (record) {
            record.lastLocation = bot.location;
            record.lastDimension = bot.dimension.id;
          }
        }
        player.sendMessage(buildListMessage(Array.from(botRegistry.values()), filterOnline, filterDeath));
      });

      return { status: CustomCommandStatus.Success, message: "§a正在查询假人列表..." };
    },
  );

  // ── /mp:delete <name> ────────────────────────────
  registry.registerCommand(
    {
      name: "mp:delete",
      description: "删除指定假人",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "请指定假人名字" };

      system.run(() => {
        const online = world.getPlayers({ tags: [BOT_TAG] }).find((b: Player) => b.name === targetName);
        if (online) {
          try {
            (online as SimulatedPlayer).disconnect();
          } catch (e: any) {
            player.sendMessage(`§c断开假人失败: ${e.message}`);
            return;
          }
        }

        if (botRegistry.has(targetName)) {
          botRegistry.delete(targetName);
          removeBotRecord(targetName);
          player.sendMessage(`§a已删除假人 §e${targetName}`);
        } else {
          player.sendMessage(`§c未找到假人 §e${targetName}`);
        }
      });

      return { status: CustomCommandStatus.Success, message: `§a正在删除假人 §e${targetName}...` };
    },
  );

  // ── /mp:online <name> ────────────────────────────
  registry.registerCommand(
    {
      name: "mp:online",
      description: "将一个已创建的假人上线并恢复所有状态",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "请指定假人名字" };

      system.run(() => {
        const record = botRegistry.get(targetName) ?? loadBotRecord(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录，请先用 /mp:create 创建`);
          return;
        }

        if (record.online) {
          player.sendMessage(`§e假人 §${targetName}§e 已经在线`);
          return;
        }

        const dim = world.getDimension(record.lastDimension);

        try {
          const bot = spawnSimulatedPlayer(
            { x: record.lastLocation.x, y: record.lastLocation.y, z: record.lastLocation.z, dimension: dim },
            record.name,
            GameMode.Survival,
          );
          bot.addTag(BOT_TAG);
          restoreBotState(bot, record);

          record.online = true;
          record.death = false;
          botRegistry.set(record.name, record);
          saveBotRecord(record);

          player.sendMessage(`§a假人 §e${record.name}§a 已上线`);
        } catch (e: any) {
          player.sendMessage(`§c假人上线失败: ${e.message}`);
        }
      });

      return { status: CustomCommandStatus.Success, message: `§a正在上线假人 §e${targetName}...` };
    },
  );

  // ── /mp:offline <name> ───────────────────────────
  registry.registerCommand(
    {
      name: "mp:offline",
      description: "将假人下线，保留所有状态记录",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      if (!targetName) return { status: CustomCommandStatus.Failure, message: "请指定假人名字" };

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }

        if (!record.online) {
          player.sendMessage(`§e假人 §e${targetName}§e 已经离线`);
          return;
        }

        // 断开世界中的假人
        const online = world.getPlayers({ tags: [BOT_TAG] }).find((b: Player) => b.name === targetName);
        if (online) {
          // 下线前刷新存档状态
          record.lastLocation = online.location;
          record.lastDimension = online.dimension.id;
          record.isSneaking = online.isSneaking;
          record.rotation = online.getRotation();

          try {
            (online as SimulatedPlayer).disconnect();
          } catch (e: any) {
            player.sendMessage(`§c断开假人失败: ${e.message}`);
            return;
          }
        }

        record.online = false;
        botRegistry.set(record.name, record);
        saveBotRecord(record);

        player.sendMessage(`§a假人 §e${record.name}§a 已下线`);
      });

      return { status: CustomCommandStatus.Success, message: `§a正在下线假人 §e${targetName}...` };
    },
  );
});

// ─── 世界加载：从持久化恢复注册表 ──────────────────────

world.afterEvents.worldLoad.subscribe(() => {
  const loaded = loadAllBotRecords();
  for (const record of loaded) {
    // 世界重启后所有假人初始为离线 & 非死亡
    record.online = false;
    record.death = false;
    botRegistry.set(record.name, record);
    saveBotRecord(record);
  }
  console.warn(`[MockPlayer] 从持久化恢复 ${botRegistry.size} 个假人记录`);
});

// ─── 状态事件监听 ──────────────────────────────────────

// 假人死亡 → 更新 & 持久化
world.afterEvents.entityDie.subscribe((event) => {
  const entity = event.deadEntity;
  if (!entity.hasTag(BOT_TAG)) return;
  const record = botRegistry.get(entity.nameTag);
  if (record) {
    record.death = true;
    record.lastLocation = entity.location;
    record.lastDimension = entity.dimension.id;
    saveBotRecord(record);
  }
});

// 假人重生 → 更新 & 持久化
world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.initialSpawn) return;
  const player = event.player;
  if (!player.hasTag(BOT_TAG)) return;
  const record = botRegistry.get(player.name);
  if (record) {
    record.death = false;
    record.online = true;
    saveBotRecord(record);
  }
});

// 假人加入 → online = true（持久化由创建方负责）
world.afterEvents.playerJoin.subscribe((event) => {
  const record = botRegistry.get(event.playerName);
  if (record) record.online = true;
});

// 假人离开 → 刷新最后位置 & 持久化
world.afterEvents.playerLeave.subscribe((event) => {
  const record = botRegistry.get(event.playerName);
  if (record) {
    record.online = false;
    saveBotRecord(record);
  }
});
