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

const TAG_PREFIX = "mockplayer:tag:";
const BOT_TAG = `${TAG_PREFIX}bot`;
const DP_PREFIX = "mockplayer:players:";

// ─── 标签系统 ──────────────────────────────────────────

interface TagDef {
  /** 显示名 */
  label: string;
  /** tag 值（含前缀） */
  value: string;
}

// 可共存的标签（可同时拥有多个）
const TAG_BOT: TagDef = { label: "假人标识", value: `${TAG_PREFIX}bot` };
const TAG_RESPAWN: TagDef = { label: "自动重生", value: `${TAG_PREFIX}respawn` };
const TAG_AUTO_JUMP: TagDef = { label: "自动跳跃", value: `${TAG_PREFIX}autoJump` };

// 互斥的标签（同一时间只能有一个生效）
const TAG_IDLE: TagDef = { label: "无状态", value: `${TAG_PREFIX}idle` };
const TAG_AUTO_MINE: TagDef = { label: "自动挖掘", value: `${TAG_PREFIX}autoMine` };
const TAG_AUTO_PLACE: TagDef = { label: "自动放置", value: `${TAG_PREFIX}autoPlace` };
const TAG_AUTO_ATTACK: TagDef = { label: "自动攻击", value: `${TAG_PREFIX}autoAttack` };
const TAG_CONTROL: TagDef = { label: "体态控制", value: `${TAG_PREFIX}control` };

/** 可共存的标签组 */
const COEXIST_TAGS: TagDef[] = [TAG_BOT, TAG_RESPAWN, TAG_AUTO_JUMP];

/** 互斥的标签组 */
const EXCLUSIVE_TAGS: TagDef[] = [TAG_IDLE, TAG_AUTO_MINE, TAG_AUTO_PLACE, TAG_AUTO_ATTACK, TAG_CONTROL];

/** 所有已定义的标签 */
const ALL_TAGS: TagDef[] = [...COEXIST_TAGS, ...EXCLUSIVE_TAGS];

/** 新的假人默认拥有的标签（value 列表） */
const DEFAULT_TAGS: string[] = [TAG_BOT.value, TAG_RESPAWN.value, TAG_IDLE.value];

/** 互斥标签的 value 集合，用于快速判断 */
const EXCLUSIVE_SET: Set<string> = new Set(EXCLUSIVE_TAGS.map((t) => t.value));

function getTagDef(value: string): TagDef | undefined {
  return ALL_TAGS.find((t) => t.value === value);
}

/** 根据用户输入的文本解析出对应的 TagDef（支持 value / label / 短名） */
function resolveTag(input: string): TagDef | undefined {
  // 1. 精确匹配 value
  let tag = ALL_TAGS.find((t) => t.value === input);
  if (tag) return tag;

  // 2. 精确匹配 label
  tag = ALL_TAGS.find((t) => t.label === input);
  if (tag) return tag;

  // 3. 作为短名匹配（自动补前缀）
  const prefixed = input.startsWith(TAG_PREFIX) ? input : `${TAG_PREFIX}${input}`;
  tag = ALL_TAGS.find((t) => t.value === prefixed);
  if (tag) return tag;

  // 4. 忽略大小写匹配
  const lower = input.toLowerCase();
  tag = ALL_TAGS.find((t) => t.value.toLowerCase() === `${TAG_PREFIX}${lower}`);
  if (tag) return tag;

  return undefined;
}

/** 构建可用标签列表文字 */
function buildTagListMessage(): string {
  const lines: string[] = ["§a可用标签:"];

  lines.push("§7━━ 可共存 ────");
  for (const t of COEXIST_TAGS) {
    lines.push(` §e${t.label}§7 (${t.value})`);
  }

  lines.push("§7━━ 互斥 ────");
  for (const t of EXCLUSIVE_TAGS) {
    lines.push(` §e${t.label}§7 (${t.value})`);
  }

  return lines.join("\n");
}

/**
 * 将标签列表同步到实体：
 * 1. 移除所有 `mockplayer:tag:` 前缀的自定义标签
 * 2. 重新添加当前标签列表中的所有标签
 */
function syncEntityTags(entity: import("@minecraft/server").Entity, tags: string[]): void {
  const existing = entity.getTags();
  for (const tag of existing) {
    if (tag.startsWith(TAG_PREFIX)) {
      entity.removeTag(tag);
    }
  }
  for (const tag of tags) {
    entity.addTag(tag);
  }
}

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
  /** 持久化的标签列表 */
  tags: string[];
  /** 体态控制器玩家 ID（仅 TAG_CONTROL 时有效） */
  controllerId?: string;
  /** 潜行状态 */
  isSneaking: boolean;
  /** 最后已知位置（死亡时清空，由 respawnPoint 或在线刷新填充） */
  lastPoint: PositionState | null;
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
        : r.lastPoint
          ? formatState(r.lastPoint)
          : formatState(r.respawnPoint) + " §7(重生点)";
    const displayTags = r.tags
      .filter((t) => t !== TAG_BOT.value && t !== TAG_IDLE.value)
      .map((t) => {
        const def = getTagDef(t);
        return def ? `§b${def.label}§7` : t;
      });
    const tagHint = displayTags.length > 0 ? ` §7[${displayTags.join(" §7| ")}]` : "";
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

          const record: BotRecord = {
            name: botName,
            online: true,
            death: false,
            entityId: bot.id,
            tags: [...DEFAULT_TAGS],
            isSneaking: player.isSneaking,
            lastPoint: currentState,
            respawnPoint: currentState,
            deathPoint: null,
          };

          // 同步标签到实体
          syncEntityTags(bot, record.tags);

          // 应用所有状态
          bot.teleport(pos, { rotation: playerRot });
          bot.isSneaking = player.isSneaking;
          bot.lookAtLocation(lookTarget, LookDuration.Continuous);

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
          if (record && record.lastPoint) {
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

        // 使用最后已知位置恢复，死亡后 lastPoint 已清空则用重生点
        const state = record.lastPoint ?? record.respawnPoint;
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
          syncEntityTags(bot, record.tags);
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
          record.lastPoint = {
            location: online.location,
            dimension: online.dimension.id,
            rotation: online.getRotation(),
            lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
          };
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

        const hasTag = record.tags.includes(TAG_RESPAWN.value);
        if (hasTag) {
          record.tags = record.tags.filter((t) => t !== TAG_RESPAWN.value);
          player.sendMessage(`§e假人 §e${record.name}§e 已关闭自动重生，死亡后将下线`);
        } else {
          record.tags.push(TAG_RESPAWN.value);
          player.sendMessage(`§a假人 §e${record.name}§a 已开启自动重生`);
        }

        // 同步到实体（如果在线）
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

  // ── /mp:tags ──────────────────────────────────────
  registry.registerCommand(
    {
      name: "mp:tags",
      description: "列出所有可用的假人标签",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
    },
    (_origin) => {
      return { status: CustomCommandStatus.Success, message: buildTagListMessage() };
    }
  );

  // ── /mp:tag <name> <add|remove|list> [tagName] ────
  registry.registerCommand(
    {
      name: "mp:tag",
      description: "管理假人的标签：add / remove / list",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        { name: "name", type: CustomCommandParamType.String },
        { name: "action", type: CustomCommandParamType.String },
      ],
      optionalParameters: [{ name: "tagName", type: CustomCommandParamType.String }],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      const action = (args[1] as string)?.toLowerCase();
      const tagInput = args[2] as string | undefined;

      if (!targetName || !action) {
        return { status: CustomCommandStatus.Failure, message: "用法: /mp:tag <假人> <add|remove|list> [标签名]" };
      }

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }

        // ── list ──
        if (action === "list") {
          const tagLabels = record.tags.map((v) => {
            const def = getTagDef(v);
            return def ? `§e${def.label}§7` : `§7${v}`;
          });
          if (tagLabels.length === 0) {
            player.sendMessage(`§e假人 §e${targetName}§e 没有标签`);
          } else {
            player.sendMessage(`§a假人 §e${targetName}§a 的标签: ${tagLabels.join(", ")}`);
          }
          return;
        }

        // add / remove 需要 tagName
        if (!tagInput) {
          player.sendMessage(`§c请指定标签名，可用标签：\n${buildTagListMessage()}`);
          return;
        }

        const tagDef = resolveTag(tagInput);
        if (!tagDef) {
          player.sendMessage(`§c未知标签 "§e${tagInput}§c"\n${buildTagListMessage()}`);
          return;
        }

        // ── add ──
        if (action === "add") {
          if (record.tags.includes(tagDef.value)) {
            player.sendMessage(`§e假人 §e${targetName}§e 已有标签 §e${tagDef.label}`);
            return;
          }

          // 如果是互斥标签，移除所有其他互斥标签
          if (EXCLUSIVE_SET.has(tagDef.value)) {
            record.tags = record.tags.filter((t) => !EXCLUSIVE_SET.has(t));
          }

          record.tags.push(tagDef.value);

          // 同步到实体
          if (record.online) {
            const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
            if (entity) syncEntityTags(entity, record.tags);
          }

          botRegistry.set(record.name, record);
          saveBotRecord(record);
          player.sendMessage(`§a已为假人 §e${targetName}§a 添加标签 §e${tagDef.label}`);
          return;
        }

        // ── remove ──
        if (action === "remove") {
          if (!record.tags.includes(tagDef.value)) {
            player.sendMessage(`§e假人 §e${targetName}§e 没有标签 §e${tagDef.label}`);
            return;
          }

          record.tags = record.tags.filter((t) => t !== tagDef.value);

          // 同步到实体
          if (record.online) {
            const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
            if (entity) syncEntityTags(entity, record.tags);
          }

          botRegistry.set(record.name, record);
          saveBotRecord(record);
          player.sendMessage(`§a已为假人 §e${targetName}§a 移除标签 §e${tagDef.label}`);
          return;
        }

        player.sendMessage(`§c未知操作 "§e${action}§c"，可用操作: add / remove / list`);
      });

      return { status: CustomCommandStatus.Success, message: "§a正在处理标签操作..." };
    }
  );

  // ── /mp:setRespawn <name> ─────────────────────────
  registry.registerCommand(
    {
      name: "mp:setRespawn",
      description: "将假人的重生点设为玩家当前位置和姿态",
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

        const lookTarget = getPlayerLookTarget(player);
        record.respawnPoint = {
          location: player.location,
          dimension: player.dimension.id,
          rotation: player.getRotation(),
          lookTarget,
        };

        botRegistry.set(record.name, record);
        saveBotRecord(record);
        player.sendMessage(`§a已更新假人 §e${record.name}§a 的重生点到当前位置`);
      });

      return { status: CustomCommandStatus.Success, message: `§a正在设置重生点...` };
    }
  );

  // ── /mp:tp <name> ─────────────────────────────────
  registry.registerCommand(
    {
      name: "mp:tp",
      description: "传送到假人身边（假人必须在线且存活）",
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
        if (!record.online || record.death) {
          player.sendMessage(`§c假人 §e${targetName}§c 不在线或已死亡，无法传送`);
          return;
        }

        const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
        if (!entity || !entity.hasTag(BOT_TAG)) {
          player.sendMessage(`§c无法在世界中找到假人 §e${targetName}§c 的实体`);
          return;
        }

        try {
          player.teleport(entity.location);
          player.sendMessage(`§a已传送到假人 §e${targetName}§a 身边`);
        } catch (e: any) {
          player.sendMessage(`§c传送失败: ${e.message}`);
        }
      });

      return { status: CustomCommandStatus.Success, message: `§a正在传送...` };
    }
  );

  // ── /mp:tphere <name> ─────────────────────────────
  registry.registerCommand(
    {
      name: "mp:tphere",
      description: "让假人传送到玩家身边（假人必须在线且存活）",
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
        if (!record.online || record.death) {
          player.sendMessage(`§c假人 §e${targetName}§c 不在线或已死亡，无法传送`);
          return;
        }

        const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
        if (!entity || !entity.hasTag(BOT_TAG)) {
          player.sendMessage(`§c无法在世界中找到假人 §e${targetName}§c 的实体`);
          return;
        }

        try {
          const bot = entity as SimulatedPlayer;
          const playerRot = player.getRotation();
          const lookTarget = getPlayerLookTarget(player);

          // 传送到玩家位置并同步朝向和视角
          bot.teleport(player.location, { rotation: playerRot });
          bot.lookAtLocation(lookTarget, LookDuration.Continuous);

          // 刷新最后位置
          if (record.lastPoint) {
            record.lastPoint.location = player.location;
            record.lastPoint.dimension = player.dimension.id;
            record.lastPoint.rotation = playerRot;
            record.lastPoint.lookTarget = lookTarget;
          }
          botRegistry.set(record.name, record);
          saveBotRecord(record);
          player.sendMessage(`§a已将假人 §e${targetName}§a 传送到身边`);
        } catch (e: any) {
          player.sendMessage(`§c传送失败: ${e.message}`);
        }
      });

      return { status: CustomCommandStatus.Success, message: `§a正在传送假人...` };
    }
  );

  // ── /mp:move <name> <x y z> ───────────────────────
  registry.registerCommand(
    {
      name: "mp:move",
      description: "让模拟玩家自动寻路到指定坐标，不填坐标则寻路到玩家位置",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "location", type: CustomCommandParamType.Location }],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      const targetLocation = (args[1] as Vector3 | undefined) ?? player.location;

      if (!targetName) {
        return { status: CustomCommandStatus.Failure, message: "用法: /mp:move <假人> [x] [y] [z]" };
      }

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }
        if (!record.online || record.death) {
          player.sendMessage(`§c假人 §e${targetName}§c 不在线或已死亡，无法移动`);
          return;
        }

        const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
        if (!entity || !entity.hasTag(BOT_TAG)) {
          player.sendMessage(`§c无法在世界中找到假人 §e${targetName}§c 的实体`);
          return;
        }

        const bot = entity as SimulatedPlayer;

        try {
          // 取消当前移动
          bot.stopMoving();

          const result = bot.navigateToLocation(targetLocation, 1);

          if (!result.isFullPath) {
            player.sendMessage(`§e假人 §e${targetName}§e 无法到达目标位置（路径不完整），但已开始移动`);
          } else {
            player.sendMessage(
              `§a假人 §e${targetName}§a 正在前往 §e${Math.floor(targetLocation.x)} ${Math.floor(targetLocation.y)} ${Math.floor(targetLocation.z)}`
            );
          }
        } catch (e: any) {
          player.sendMessage(`§c假人移动失败: ${e.message}`);
        }
      });

      return { status: CustomCommandStatus.Success, message: `§a正在让假人移动...` };
    }
  );

  // ── /mp:control <name> [true|false] ────────────────
  registry.registerCommand(
    {
      name: "mp:control",
      description: "体态控制：开启后假人持续跟随玩家位置/朝向/视角",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "enable", type: CustomCommandParamType.Boolean }],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      const enable = args[1] as boolean | undefined;

      if (!targetName) {
        return { status: CustomCommandStatus.Failure, message: "用法: /mp:control <假人> [true|false]" };
      }

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }

        const turnOn = enable ?? true;

        if (turnOn) {
          // 开启体态控制：添加 TAG_CONTROL，移除其他互斥标签，记录控制器
          record.tags = record.tags.filter((t) => !EXCLUSIVE_SET.has(t));
          if (!record.tags.includes(TAG_CONTROL.value)) {
            record.tags.push(TAG_CONTROL.value);
          }
          record.controllerId = player.id;

          // 立即同步一次
          if (record.online) {
            const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
            if (entity) {
              syncEntityTags(entity, record.tags);
              const lookTarget = getPlayerLookTarget(player);
              (entity as SimulatedPlayer).teleport(player.location, { rotation: player.getRotation() });
              (entity as SimulatedPlayer).lookAtLocation(lookTarget, LookDuration.Continuous);
            }
          }

          player.sendMessage(`§a已开启假人 §e${targetName}§a 的体态控制`);
        } else {
          // 关闭体态控制
          record.tags = record.tags.filter((t) => t !== TAG_CONTROL.value);
          record.controllerId = undefined;

          // 如果没有任何互斥标签了，回退到无状态
          const hasExclusive = record.tags.some((t) => EXCLUSIVE_SET.has(t));
          if (!hasExclusive) {
            record.tags.push(TAG_IDLE.value);
          }

          if (record.online) {
            const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
            if (entity) syncEntityTags(entity, record.tags);
          }

          player.sendMessage(`§e已关闭假人 §e${targetName}§e 的体态控制，体态固定`);
        }

        botRegistry.set(record.name, record);
        saveBotRecord(record);
      });

      return { status: CustomCommandStatus.Success, message: "§a正在处理体态控制..." };
    }
  );

  // ── /mp:sneak <name> [true|false] ──────────────────
  registry.registerCommand(
    {
      name: "mp:sneak",
      description: "设置假人的潜行状态",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "sneak", type: CustomCommandParamType.Boolean }],
    },
    (origin, ...args) => {
      if (!origin.sourceEntity) return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      const player = origin.sourceEntity as Player;
      const targetName = args[0] as string;
      const sneak = args[1] as boolean | undefined;

      if (!targetName) {
        return { status: CustomCommandStatus.Failure, message: "用法: /mp:sneak <假人> [true|false]" };
      }

      system.run(() => {
        const record = botRegistry.get(targetName);
        if (!record) {
          player.sendMessage(`§c未找到假人 §e${targetName}§c 的记录`);
          return;
        }

        const shouldSneak = sneak ?? true;
        record.isSneaking = shouldSneak;

        if (record.online) {
          const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
          if (entity?.hasTag(BOT_TAG)) {
            (entity as Player).isSneaking = shouldSneak;
          }
        }

        botRegistry.set(record.name, record);
        saveBotRecord(record);
        player.sendMessage(shouldSneak ? `§a假人 §e${targetName}§a 已潜行` : `§a假人 §e${targetName}§a 已站起`);
      });

      return { status: CustomCommandStatus.Success, message: "§a正在设置潜行..." };
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

  // 世界加载完成后启动标签行为引擎
  startTagBehaviors();
});

// ─── 标签行为引擎 ──────────────────────────────────────

interface TagBehavior {
  /** 对应的标签值 */
  tagValue: string;
  /** 每次执行的间隔 tick */
  intervalTicks: number;
  /** 执行任务 */
  execute: (bot: SimulatedPlayer, record: BotRecord) => void;
}

const TAG_BEHAVIORS: TagBehavior[] = [
  {
    tagValue: TAG_AUTO_MINE.value,
    intervalTicks: 8,
    execute(bot, _record) {
      const hit = bot.getBlockFromViewDirection({ maxDistance: 6 });
      if (hit) {
        bot.breakBlock(hit.block.location, hit.face);
      }
    },
  },
  {
    tagValue: TAG_AUTO_ATTACK.value,
    intervalTicks: 15,
    execute(bot, _record) {
      bot.attack();
    },
  },
  {
    tagValue: TAG_AUTO_JUMP.value,
    intervalTicks: 3,
    execute(bot, _record) {
      bot.jump();
    },
  },
  {
    tagValue: TAG_CONTROL.value,
    intervalTicks: 2,
    execute(bot, record) {
      if (!record.controllerId) return;
      const controller = world.getEntity(record.controllerId);
      if (!controller) return;

      const playerRot = (controller as Player).getRotation();
      const lookTarget = getPlayerLookTarget(controller as Player);

      bot.teleport(controller.location, { rotation: playerRot });
      bot.lookAtLocation(lookTarget, LookDuration.Continuous);
    },
  },
];

function startTagBehaviors(): void {
  // 标签行为引擎
  for (const behavior of TAG_BEHAVIORS) {
    system.runInterval(() => {
      for (const [, record] of botRegistry) {
        if (!record.online || record.death) continue;
        if (!record.tags.includes(behavior.tagValue)) continue;

        const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
        if (!entity || !entity.hasTag(BOT_TAG)) continue;

        try {
          behavior.execute(entity as SimulatedPlayer, record);
        } catch {
          // 单次执行失败不影响其他假人
        }
      }
    }, behavior.intervalTicks);
  }

  // 所有在线存活假人每 5 秒自动持久化数据
  system.runInterval(() => {
    for (const [, record] of botRegistry) {
      if (!record.online || record.death) continue;
      if (!record.entityId) continue;

      const entity = world.getEntity(record.entityId);
      if (!entity || !entity.hasTag(BOT_TAG)) continue;

      // 刷新位置/朝向/维度
      if (!record.lastPoint) {
        record.lastPoint = {
          location: entity.location,
          dimension: entity.dimension.id,
          rotation: (entity as Player).getRotation(),
          lookTarget: record.respawnPoint.lookTarget,
        };
      } else {
        record.lastPoint.location = entity.location;
        record.lastPoint.dimension = entity.dimension.id;
        record.lastPoint.rotation = (entity as Player).getRotation();
      }
      record.isSneaking = (entity as Player).isSneaking;

      saveBotRecord(record);
    }
  }, 100); // 100 ticks = 5s
}

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
    lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
  };

  record.death = true;
  record.deathPoint = deathState;
  record.lastPoint = null; // 死亡清空最后点

  world.sendMessage(
    `§7[§a假人§7] §c${botName} 死亡了 §7@ ${formatPos(deathState.location)} §8${formatDimensionId(deathState.dimension)}`
  );

  // 有自动重生标签 → 被动复活，恢复到重生点
  if (entity.hasTag(TAG_RESPAWN.value)) {
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
