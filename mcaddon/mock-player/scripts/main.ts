import {
  world,
  system,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  GameMode,
  StartupEvent,
  Player,
  Vector3,
  Vector2,
} from "@minecraft/server";
import { spawnSimulatedPlayer, LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

// ─── 常量 ──────────────────────────────────────────────

const BOT_TAG = "mp:bot";
const RESPAWN_TAG = "mockplayer:tag:respawn";
const DP_PREFIX = "mockplayer:players:";

// ─── 类型定义 ──────────────────────────────────────────

/** 点位状态：完整的位置、维度、朝向、视角 */
interface PositionState {
  location: Vector3;
  dimension: string;
  rotation: Vector2;
  lookTarget: Vector3;
}

/** 假人持久化记录 */
interface BotRecord {
  name: string;
  online: boolean;
  death: boolean;
  /** SimulatedPlayer 的实体 ID（在线时有效） */
  entityId?: string;
  /** 持久化的标签列表（不含 BOT_TAG） */
  tags: string[];
  /** 潜行状态 */
  isSneaking: boolean;
  /** 最后已知位置 */
  lastPoint: PositionState;
  /** 重生点 */
  respawnPoint: PositionState;
  /** 死亡点（死亡时记录，重生后清空） */
  deathPoint: PositionState | null;
}

// ─── 全局状态 ──────────────────────────────────────────

const botRegistry: Map<string, BotRecord> = new Map();
let botCounter = 1;

// ─── 动态属性持久化 ────────────────────────────────────

function getDPKey(name: string): string {
  return `${DP_PREFIX}${name}`;
}

function saveBotRecord(record: BotRecord): void {
  try {
    world.setDynamicProperty(getDPKey(record.name), JSON.stringify(record));
  } catch (e: any) {
    console.warn(`[MockPlayer] 保存假人 ${record.name} 失败: ${e.message}`);
  }
}

function loadBotRecord(name: string): BotRecord | undefined {
  const value = world.getDynamicProperty(getDPKey(name));
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as BotRecord;
  } catch {
    return undefined;
  }
}

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
      // 损坏数据跳过
    }
  }
  return records;
}

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
  const hit = player.getBlockFromViewDirection({ maxDistance });
  if (hit) {
    const b = hit.block;
    return { x: b.location.x + 0.5, y: b.location.y + 0.5, z: b.location.z + 0.5 };
  }
  const head = player.getHeadLocation();
  const dir = rotationToDirection(player.getRotation());
  return {
    x: head.x + dir.x * maxDistance,
    y: head.y + dir.y * maxDistance,
    z: head.z + dir.z * maxDistance,
  };
}

function formatDimensionId(dimId: string): string {
  const map: Record<string, string> = {
    "minecraft:overworld": "主世界",
    "minecraft:nether": "下界",
    "minecraft:the_end": "末地",
  };
  return map[dimId] ?? dimId;
}

function formatPos(v: Vector3): string {
  return `§7[§f${Math.floor(v.x)} §f${Math.floor(v.y)} §f${Math.floor(v.z)}§7]`;
}

function formatState(state: PositionState): string {
  return `${formatPos(state.location)} §8${formatDimensionId(state.dimension)} §7旋转(${Math.floor(state.rotation.x)},${Math.floor(state.rotation.y)})`;
}

// ─── 格式化名字 ────────────────────────────────────────

function generateBotName(): string {
  const n = botCounter++;
  return `sim${String(n).padStart(3, "0")}`;
}

// ─── 状态应用 ──────────────────────────────────────────

/** 将存档的点位状态恢复到 SimulatedPlayer */
function applyPositionState(bot: SimulatedPlayer, state: PositionState, sneaking: boolean): void {
  const dim = world.getDimension(state.dimension);
  bot.teleport(state.location, { rotation: state.rotation });
  bot.isSneaking = sneaking;
  bot.lookAtLocation(state.lookTarget, LookDuration.Continuous);
}

// ─── 列表消息 ──────────────────────────────────────────

function buildListMessage(records: BotRecord[], filterOnline?: boolean, filterDeath?: boolean): string {
  let filtered = records;
  if (filterOnline !== undefined) {
    filtered = filtered.filter((r) => r.online === filterOnline);
  }
  if (filterDeath !== undefined) {
    filtered = filtered.filter((r) => r.death === filterDeath);
  }
  if (filtered.length === 0) return "§e没有匹配的假人";

  const lines = filtered.map((r) => {
    const icon = r.death ? "§c💀" : r.online ? "§a✔" : "§7❌";
    const txt = r.death ? "§c死亡" : r.online ? "§a在线" : "§7离线";
    const pos =
      r.death && r.deathPoint
        ? `${formatPos(r.deathPoint.location)} §8${formatDimensionId(r.deathPoint.dimension)} §7(死亡点)`
        : formatState(r.lastPoint);
    const tagHint = r.tags.includes(RESPAWN_TAG) ? " §b[自动重生]" : "";
    return `${icon} §e${r.name}§7 — ${txt}§7 | ${pos}${tagHint}`;
  });

  lines.unshift(`§a假人列表 (§b${filtered.length}§a/${records.length}§a):`);
  return lines.join("\n");
}

// ─── 从玩家构建 PositionState ──────────────────────────

function capturePlayerState(player: Player, lookTarget: Vector3): PositionState {
  return {
    location: player.location,
    dimension: player.dimension.id,
    rotation: player.getRotation(),
    lookTarget,
  };
}

function capturePlayerStateFromRotation(
  location: Vector3,
  dimension: string,
  rotation: Vector2,
  lookTarget: Vector3
): PositionState {
  return { location, dimension, rotation, lookTarget };
}

// ─── 自定义命令注册 ────────────────────────────────────

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

      // 创建当前点状态（同时也是重生点）
      const currentState: PositionState = {
        location: pos,
        dimension: dimension.id,
        rotation: playerRot,
        lookTarget,
      };

      system.run(() => {
        try {
          const bot = spawnSimulatedPlayer({ x: pos.x, y: pos.y, z: pos.z, dimension }, botName, GameMode.Survival);
          bot.addTag(BOT_TAG);
          bot.addTag(RESPAWN_TAG);

          // 应用所有状态
          bot.teleport(pos, { rotation: playerRot });
          bot.isSneaking = player.isSneaking;
          bot.lookAtLocation(lookTarget, LookDuration.Continuous);

          const record: BotRecord = {
            name: botName,
            online: true,
            death: false,
            entityId: bot.id,
            tags: [RESPAWN_TAG],
            isSneaking: player.isSneaking,
            lastPoint: currentState,
            respawnPoint: currentState,
            deathPoint: null,
          };
          botRegistry.set(botName, record);
          saveBotRecord(record);

          player.sendMessage(`§a成功创建假人 §e${botName}§b [自动重生]`);
        } catch (e: any) {
          player.sendMessage(`§c创建假人失败: ${e.message}`);
        }
      });

      return { status: CustomCommandStatus.Success, message: `§a正在创建假人 §e${botName}...` };
    }
  );

  // ── /mp:list [online] [death] ──────────────────────
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
            record.lastPoint.location = bot.location;
            record.lastPoint.dimension = bot.dimension.id;
            record.lastPoint.rotation = bot.getRotation();
          }
        }
        player.sendMessage(buildListMessage(Array.from(botRegistry.values()), filterOnline, filterDeath));
      });

      return { status: CustomCommandStatus.Success, message: "§a正在查询假人列表..." };
    }
  );

  // ── /mp:delete <name> ──────────────────────────────
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
    }
  );

  // ── /mp:online <name> ──────────────────────────────
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
          player.sendMessage(`§e假人 §e${targetName}§e 已经在线`);
          return;
        }

        // 使用 lastPoint 恢复最近的状态
        const state = record.lastPoint;
        const dim = world.getDimension(state.dimension);

        try {
          const bot = spawnSimulatedPlayer(
            {
              x: state.location.x,
              y: state.location.y,
              z: state.location.z,
              dimension: dim,
            },
            record.name,
            GameMode.Survival
          );
          bot.addTag(BOT_TAG);
          // 恢复所有持久化标签
          for (const t of record.tags) {
            bot.addTag(t);
          }
          applyPositionState(bot, state, record.isSneaking);

          record.online = true;
          record.death = false;
          record.entityId = bot.id;
          botRegistry.set(record.name, record);
          saveBotRecord(record);

          player.sendMessage(`§a假人 §e${record.name}§a 已上线`);
        } catch (e: any) {
          player.sendMessage(`§c假人上线失败: ${e.message}`);
        }
      });

      return { status: CustomCommandStatus.Success, message: `§a正在上线假人 §e${targetName}...` };
    }
  );

  // ── /mp:offline <name> ─────────────────────────────
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

        const online = world.getPlayers({ tags: [BOT_TAG] }).find((b: Player) => b.name === targetName);
        if (online) {
          // 下线前刷新存档
          record.lastPoint.location = online.location;
          record.lastPoint.dimension = online.dimension.id;
          record.lastPoint.rotation = online.getRotation();
          record.isSneaking = online.isSneaking;

          try {
            (online as SimulatedPlayer).disconnect();
          } catch (e: any) {
            player.sendMessage(`§c断开假人失败: ${e.message}`);
            return;
          }
        }

        record.online = false;
        record.entityId = undefined;
        botRegistry.set(record.name, record);
        saveBotRecord(record);
        player.sendMessage(`§a假人 §e${record.name}§a 已下线`);
      });

      return { status: CustomCommandStatus.Success, message: `§a正在下线假人 §e${targetName}...` };
    }
  );

  // ── /mp:kill <name> ────────────────────────────────
  registry.registerCommand(
    {
      name: "mp:kill",
      description: "杀死一个在线的假人",
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
          player.sendMessage(`§e假人 §e${targetName}§e 不在线，无法杀死`);
          return;
        }
        if (record.death) {
          player.sendMessage(`§e假人 §e${targetName}§e 已经死亡，无需重复杀死`);
          return;
        }

        const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
        if (!entity || !entity.hasTag(BOT_TAG)) {
          player.sendMessage(`§c无法在世界中找到假人 §e${targetName}§c 的实体`);
          return;
        }

        // entityDie 事件会处理状态更新
        (entity as SimulatedPlayer).kill();
        player.sendMessage(`§a已杀死假人 §e${targetName}`);
      });

      return { status: CustomCommandStatus.Success, message: `§a正在杀死假人 §e${targetName}...` };
    }
  );

  // ── /mp:respawn <name> ─────────────────────────────
  registry.registerCommand(
    {
      name: "mp:respawn",
      description: "切换假人的自动重生标签（死亡时自动复活）",
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

        const hasTag = record.tags.includes(RESPAWN_TAG);
        if (hasTag) {
          // 移除标签
          record.tags = record.tags.filter((t) => t !== RESPAWN_TAG);
          // 如果在线，也从实体上移除
          if (record.online) {
            const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
            if (entity?.hasTag(RESPAWN_TAG)) {
              entity.removeTag(RESPAWN_TAG);
            }
          }
          player.sendMessage(`§e假人 §e${record.name}§e 已关闭自动重生，死亡后将下线`);
        } else {
          // 添加标签
          record.tags.push(RESPAWN_TAG);
          // 如果在线，也加到实体上
          if (record.online) {
            const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
            if (entity && !entity.hasTag(RESPAWN_TAG)) {
              entity.addTag(RESPAWN_TAG);
            }
          }
          player.sendMessage(`§a假人 §e${record.name}§a 已开启自动重生`);
        }

        botRegistry.set(record.name, record);
        saveBotRecord(record);
      });

      return { status: CustomCommandStatus.Success, message: `§a正在切换假人 §e${targetName}§a 的重生标签...` };
    }
  );
});

// ─── 世界加载：从持久化恢复注册表 ──────────────────────

world.afterEvents.worldLoad.subscribe(() => {
  const loaded = loadAllBotRecords();
  for (const record of loaded) {
    record.online = false;
    record.death = false;
    record.entityId = undefined;
    botRegistry.set(record.name, record);
    saveBotRecord(record);
  }
  console.warn(`[MockPlayer] 从持久化恢复 ${botRegistry.size} 个假人记录`);
});

// ─── 状态事件监听 ──────────────────────────────────────

// ─── 假人状态事件监听（含通知） ────────────────────────

// 假人死亡 → 通知
world.afterEvents.entityDie.subscribe((event) => {
  const entity = event.deadEntity;
  if (!entity.hasTag(BOT_TAG)) return;

  const record = botRegistry.get(entity.nameTag);
  if (!record) return;

  const bot = entity as SimulatedPlayer;
  const botName = record.name;

  // 记录死亡点
  const deathState: PositionState = {
    location: entity.location,
    dimension: entity.dimension.id,
    rotation: bot.getRotation(),
    lookTarget: record.lastPoint.lookTarget,
  };

  record.death = true;
  record.deathPoint = deathState;
  record.lastPoint = deathState;

  world.sendMessage(
    `§7[§a假人§7] §c${botName} 死亡了 §7@ ${formatPos(deathState.location)} §8${formatDimensionId(deathState.dimension)}`
  );

  // 有自动重生标签 → 被动复活，恢复到重生点
  if (entity.hasTag(RESPAWN_TAG)) {
    try {
      bot.respawn();
      applyPositionState(bot, record.respawnPoint, record.isSneaking);

      record.death = false;
      record.deathPoint = null;
      record.lastPoint = { ...record.respawnPoint };
      saveBotRecord(record);

      world.sendMessage(`§7[§a假人§7] §b${botName} 已自动复活`);
      return;
    } catch (e: any) {
      world.sendMessage(`§7[§a假人§7] §c${botName} 自动重生失败: ${e.message}`);
    }
  }

  // 无自动重生标签 → 死亡下线
  record.online = false;
  record.entityId = undefined;
  saveBotRecord(record);
  bot.disconnect();
  world.sendMessage(`§7[§a假人§7] §e${botName} 已死亡下线`);
});

// 假人重生（非首次加入）→ 通知
world.afterEvents.playerSpawn.subscribe((event) => {
  if (event.initialSpawn) return;
  const player = event.player;
  if (!player.hasTag(BOT_TAG)) return;

  const record = botRegistry.get(player.name);
  if (record) {
    record.death = false;
    record.online = true;
    saveBotRecord(record);
    world.sendMessage(`§7[§a假人§7] §b${record.name} 重生了`);
  }
});

// 假人加入世界 → 通知
world.afterEvents.playerJoin.subscribe((event) => {
  const record = botRegistry.get(event.playerName);
  if (!record) return;

  record.online = true;
  world.sendMessage(`§7[§a假人§7] §a${record.name} 加入了游戏`);
});

// 假人离开世界 → 通知
world.afterEvents.playerLeave.subscribe((event) => {
  const record = botRegistry.get(event.playerName);
  if (!record) return;

  record.online = false;
  record.entityId = undefined;
  saveBotRecord(record);
  world.sendMessage(`§7[§a假人§7] §e${record.name} 离开了游戏`);
});
