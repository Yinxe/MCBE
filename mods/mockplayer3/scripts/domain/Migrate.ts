// ─── 旧档迁移：一次性导入器核心（domain 纯逻辑） ─────────────────
// 旧版 per-name JSON 记录 → schema v2 BotRecord 的纯映射；分配 botId 与触世界由 engine 薄壳负责，
// 本模块纯函数拿 JSON 夹具就能单测。
// 迁移约定：
// - 枚举旧记录时跳过 `:inv:`/`:equip:`/`:bind` 子键，物品键走 parseLegacyItemKey。
// - 名字规范化沿用 "$"→"sim-" 前缀兼容（Identity.normalizeBotName）。
// - workMode 取值优先级：记录字段（含中文别名）> 旧行为标签映射（raid 优先）
//   > 旧 aiBehavior 字段 > "none"。
// - lookTarget 不迁移：注视是租约不是档案；只取 rotation 身体朝向（x=pitch，y=yaw）。
// - 旧物品绑定与新绑定表同键同构，零复制采纳；记录本体只留 regionId 指针，绑定写独立键。

import { normalizeBotName, playerKey, validateBotName } from "./Identity";
import type { Vec2, Vec3 } from "./Coords";
import { defaultEnabledModes, modeAliasMap } from "./Catalog";
import {
  DEFAULT_CREATE_QUOTA,
  DEFAULT_ONLINE_QUOTA,
  DEFAULT_TOKEN_ITEM,
  normalizeAuxTickingRadius,
  TOKEN_ITEM_OPTIONS,
  WORK_MODE_POLICY_V_ALL_ON,
} from "./Config";
import type {
  BotRecord,
  EquipSlotName,
  HomePoint,
  RespawnPoint,
  SerializedEffect,
  StorageBinding,
  WorkMode,
} from "./Record";
import { EQUIP_SLOT_NAMES, INVENTORY_SIZE, isBindingShape } from "./Record";

// ─── 旧键空间 ──

/** 旧记录 DP 前缀 */
export const LEGACY_DP_PREFIX = "mockplayer:players:";

/** 旧标签值前缀 */
export const LEGACY_TAG_PREFIX = "mockplayer:tag:";

/** 旧绑定表 key 后缀（独立持久化，`${LEGACY_DP_PREFIX}<name>:bind`） */
export const LEGACY_BIND_SUFFIX = ":bind";

/**
 * DP 键是否旧记录键：前缀匹配且排除 `:inv:`/`:equip:` 物品子键与 `:bind` 结尾
 * 的绑定表键（绑定 key 无尾部冒号，不能用 `:bind:` 匹配）。
 */
export function isLegacyRecordKey(id: string): boolean {
  if (!id.startsWith(LEGACY_DP_PREFIX)) return false;
  if (id.includes(":inv:") || id.includes(":equip:")) return false;
  if (id.endsWith(LEGACY_BIND_SUFFIX)) return false;
  return true;
}

/** 从旧记录 key 提取（旧格式）假人名 */
export function legacyNameOfRecordKey(id: string): string {
  return id.slice(LEGACY_DP_PREFIX.length);
}

/** 某旧假人名对应的绑定表 key */
export function legacyBindingKey(name: string): string {
  return `${LEGACY_DP_PREFIX}${name}${LEGACY_BIND_SUFFIX}`;
}

// ─── 旧记录形状（宽松接收 unknown，逐字段防御） ──

/** 旧 PositionState：location + dimension + rotation{x,y} + lookTarget（注视丢弃） */
interface LegacyPositionState {
  location?: Partial<Vec3>;
  dimension?: unknown;
  rotation?: Partial<Vec2>;
  lookTarget?: unknown;
}

/** 旧经验记录（xpProgress 字段名与新 progress 不同） */
interface LegacyExperience {
  level?: unknown;
  xpProgress?: unknown;
  totalXp?: unknown;
}

/** 旧序列化效果（duration 即 tick 数） */
interface LegacyEffect {
  id?: unknown;
  duration?: unknown;
  amplifier?: unknown;
}

/** 旧 BotRecord 的 JSON 形态（全部字段按 unknown 处理——损坏档不可信） */
export interface LegacyRecordJson {
  name?: unknown;
  ownerName?: unknown;
  online?: unknown;
  death?: unknown;
  entityId?: unknown;
  tags?: unknown;
  workMode?: unknown;
  /** 上代行为字段（workMode 缺省时兜底来源） */
  aiBehavior?: unknown;
  /** 已退役键：只用于丢弃报备 */
  actionIntervalTicks?: unknown;
  woodcutMode?: unknown; // 已退役键：只用于丢弃报备
  controllerId?: unknown;
  isSneaking?: unknown;
  lastPoint?: LegacyPositionState | null;
  respawnPoint?: LegacyPositionState | null;
  deathPoint?: LegacyPositionState | null;
  experience?: LegacyExperience;
  effects?: unknown;
  spawnMode?: unknown;
}

/** 旧档最低可解析判定：对象 + 非空 string name（绑定表/坏 JSON 不能当记录处理） */
export function isLegacyRecordShape(value: unknown): value is LegacyRecordJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { name?: unknown };
  return typeof v.name === "string" && v.name.length > 0;
}

/** 旧绑定表形状守卫——与新绑定表同构，零复制采纳凭此 */
export function isLegacyBindingShape(value: unknown): value is StorageBinding {
  return isBindingShape(value);
}

// ─── 旧标签 → 开关 / 工作模式 ──────────────────────────────────

/** 旧标签 → workMode（仅五项参与模式推导，其余已知标签只消费不映射） */
const LEGACY_TAG_MODE: Record<string, WorkMode> = {
  autoMine: "mine",
  autoPlace: "place",
  autoAttack: "attack",
  wanderMode: "wander",
  raidMode: "raid",
};

/** 已知但不参与模式推导的旧标签（消费不落脏数据报备） */
const LEGACY_KNOWN_NON_MODE_TAGS: readonly string[] = ["autoUse", "vaultMode", "fishMode"];

/** 已被迁移消费的旧标签短名（映射/开关/标识）——其余 tag 值视为脏数据丢弃并报备 */
const LEGACY_CONSUMED = new Set<string>([
  "bot", // 身份标识：v2 记录即真源（F-07）
  "respawn", // → switches.autoRespawn
  "idle", // → workMode none（兜底默认即是）
  "control", // 体态控制能力已移除，旧标签不迁移
  "autoJump", // 已禁用功能
  ...Object.keys(LEGACY_TAG_MODE),
  ...LEGACY_KNOWN_NON_MODE_TAGS,
]);

function legacyTagShortName(value: string): string | undefined {
  return value.startsWith(LEGACY_TAG_PREFIX) ? value.slice(LEGACY_TAG_PREFIX.length) : undefined;
}

/**
 * 旧 workMode 字符串归一：id 或中文别名（目录派生）均可识别。
 * @param raw - 旧记录 workMode 原值
 * @returns 无法识别返回 undefined（迁移规则：落到标签映射，仍无 → "none"）
 */
export function normalizeLegacyWorkMode(raw: unknown): WorkMode | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim();
  // 上游的「自定义动作」（custom）已由「长流程模式」（script）取代：
  // 老存档里的 custom / 自定义动作 一律迁到 script，免得记录被判成非法模式。
  if (key === "custom" || key === "自定义动作") return "script";
  const hit = modeAliasMap()[key];
  return hit;
}

// ─── 点位映射 ──

function asVec3(value: Partial<Vec3> | undefined): Vec3 | undefined {
  if (!value) return undefined;
  const { x, y, z } = value;
  if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
  if (typeof y !== "number" || !Number.isFinite(y)) return undefined;
  if (typeof z !== "number" || !Number.isFinite(z)) return undefined;
  return { x, y, z };
}

/**
 * 旧 rotation 约定 Bedrock 语义：x=pitch、y=yaw；lookTarget 一律丢弃（注视是租约不是档案）。
 */
function toHomePoint(ps: LegacyPositionState | null | undefined, dimensionFallback: string): HomePoint | undefined {
  const position = asVec3(ps?.location);
  if (!position) return undefined;
  const rot = ps!.rotation;
  return {
    position,
    pitch: typeof rot?.x === "number" && Number.isFinite(rot.x) ? rot.x : 0,
    yaw: typeof rot?.y === "number" && Number.isFinite(rot.y) ? rot.y : 0,
  };
}

function toRespawnPoint(
  ps: LegacyPositionState | null | undefined,
  home: HomePoint,
  dimensionId: string
): RespawnPoint {
  const position = asVec3(ps?.location) ?? home.position;
  const rot = ps?.rotation;
  return {
    position,
    pitch: typeof rot?.x === "number" && Number.isFinite(rot.x) ? rot.x : home.pitch,
    yaw: typeof rot?.y === "number" && Number.isFinite(rot.y) ? rot.y : home.yaw,
    dimensionId: typeof ps?.dimension === "string" && ps.dimension.length > 0 ? ps.dimension : dimensionId,
  };
}

// ─── 经验 / 效果 ──

function migrateEffects(raw: unknown, notices: string[]): SerializedEffect[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) notices.push("effects 字段损坏，按无效果处理");
    return [];
  }
  const out: SerializedEffect[] = [];
  for (const item of raw) {
    const e = item as LegacyEffect;
    if (typeof e?.id !== "string" || e.id.length === 0) continue;
    const durationTicks =
      typeof e.duration === "number" && Number.isFinite(e.duration) ? Math.max(0, Math.floor(e.duration)) : 0;
    const amplifier =
      typeof e.amplifier === "number" && Number.isFinite(e.amplifier) ? Math.max(0, Math.floor(e.amplifier)) : 0;
    if (durationTicks <= 0) continue; // 已到期效果不回放
    out.push({ id: e.id, durationTicks, amplifier });
  }
  return out;
}

function migrateExperience(raw: unknown, notices: string[]): BotRecord["experience"] {
  const e = (typeof raw === "object" && raw !== null ? raw : {}) as LegacyExperience;
  const level = typeof e.level === "number" && Number.isFinite(e.level) ? Math.max(0, Math.floor(e.level)) : 0;
  const progress =
    typeof e.xpProgress === "number" && Number.isFinite(e.xpProgress) ? Math.max(0, Math.floor(e.xpProgress)) : 0;
  let totalXp = typeof e.totalXp === "number" && Number.isFinite(e.totalXp) ? Math.max(0, Math.floor(e.totalXp)) : 0;
  if (totalXp === 0 && (level > 0 || progress > 0)) {
    // 旧档可能只有 level/progress——迁移保持数值原样，不伪造总值
    notices.push("经验 totalXp 缺失，按 0 保留（回放以 level/progress 为准）");
  }
  return { level, progress, totalXp };
}

// ─── 迁移结果 ──

/** 单条迁移输出：record+binding=成功产物；error=拒绝原因（保留旧键待查）；notices=报备 */
export type MigrateOutcome =
  { ok: true; record: BotRecord; binding: StorageBinding | null; notices: string[] } | { ok: false; error: string };

/** migrateRecord 注入上下文（botId/时间戳/兜底区域由 engine 提供，保持纯函数） */
export interface MigrateContext {
  /** 新分配的稳定整数身份 */
  botId: number;
  /** 当前时间戳（ms） */
  now: number;
  /** 旧物品不在本系统内时，engine 侧新建仓区要用的兜底 regionId */
  defaultRegionId: string;
  /** 旧绑定表 JSON（来自 legacyBindingKey(旧名) 的 DP 值） */
  legacyBinding?: unknown;
}

/**
 * 旧记录 → schema v2 BotRecord 的映射核心。
 * 幂等前提由调用方保证（旧名与 mp:name:* 索引比对，已迁移的跳过）；
 * 本函数失败时调用方保留旧键并输出 error。
 * @param raw - 旧记录 JSON.parse 产物（unknown——损坏档不可信）
 * @param ctx - botId/时间/兜底区域注入
 * @returns 迁移结果（ok/fail）
 */
export function migrateRecord(raw: unknown, ctx: MigrateContext): MigrateOutcome {
  if (!isLegacyRecordShape(raw)) return { ok: false, error: "记录形状非法（缺 name）" };

  const name = normalizeBotName(String(raw.name));
  const nameError = validateBotName(name);
  if (nameError) return { ok: false, error: `名字不可迁移（${raw.name}）：${nameError}` };

  const notices: string[] = [];
  if (typeof raw.name === "string" && raw.name !== name) notices.push(`名字已规范化 ${raw.name} → ${name}`);

  // 点位：lastPoint 优先（最后已知位置），缺则 respawnPoint；双缺 = 无法定家 → 拒绝
  const dimensionFromPoint =
    typeof raw.lastPoint?.dimension === "string" && raw.lastPoint.dimension.length > 0
      ? raw.lastPoint.dimension
      : typeof raw.respawnPoint?.dimension === "string" && raw.respawnPoint.dimension.length > 0
        ? raw.respawnPoint.dimension
        : "overworld";
  const home = toHomePoint(raw.lastPoint ?? raw.respawnPoint, dimensionFromPoint);
  if (!home) {
    return { ok: false, error: "缺少合法点位（lastPoint/respawnPoint 均损坏），保留旧键待查" };
  }
  const respawnPoint = toRespawnPoint(raw.respawnPoint, home, dimensionFromPoint);

  // 标签：消费旧定义，映射开关/模式；未知值丢弃并报备
  let modeFromTags: WorkMode | undefined;
  let hasRespawnTag = false;
  if (Array.isArray(raw.tags)) {
    for (const t of raw.tags) {
      if (typeof t !== "string") continue;
      const short = legacyTagShortName(t) ?? t;
      if (short === "respawn") hasRespawnTag = true;
      else if (LEGACY_TAG_MODE[short]) {
        modeFromTags = LEGACY_TAG_MODE[short]!;
        if (modeFromTags === "raid") break; // raid 优先定案
      }
    }
    for (const t of raw.tags) {
      if (typeof t !== "string") continue;
      const short = legacyTagShortName(t) ?? t;
      if (!LEGACY_CONSUMED.has(short)) notices.push(`丢弃未识别标签 ${t}`);
    }
  } else if (raw.tags !== undefined) {
    notices.push("tags 字段损坏，按空处理");
  }

  // workMode 优先级：字段（含中文别名；缺/"none" 视为未设置）> 行为标签映射 > 旧 aiBehavior > none
  let workMode = normalizeLegacyWorkMode(raw.workMode);
  if (workMode === undefined && typeof raw.workMode === "string" && raw.workMode.trim().length > 0) {
    notices.push(`workMode "${raw.workMode}" 无法识别，按标签映射兜底`);
  }
  if (workMode === undefined || workMode === "none") {
    let fallback = modeFromTags;
    let source = "旧行为标签";
    if (fallback === undefined) {
      fallback = normalizeLegacyWorkMode(raw.aiBehavior);
      source = "旧 aiBehavior 字段";
    }
    if (fallback !== undefined && fallback !== "none") {
      workMode = fallback;
      notices.push(`工作模式由${source}迁移为 ${fallback}`);
    }
  }
  if (workMode === "follow") notices.push("跟随目标旧版未持久化，需重新指定（/mp:follow）");

  // 物品仓：绑定表同构零复制采纳；无/损坏 → binding=null，regionId 兜底为新建仓区
  let binding: StorageBinding | null = null;
  let regionId = ctx.defaultRegionId;
  if (isLegacyBindingShape(ctx.legacyBinding)) {
    binding = {
      regionId: ctx.legacyBinding.regionId,
      inv: { ...ctx.legacyBinding.inv },
      equip: { ...ctx.legacyBinding.equip },
    };
    regionId = ctx.legacyBinding.regionId;
  } else if (ctx.legacyBinding !== undefined && ctx.legacyBinding !== null) {
    notices.push("旧绑定表损坏，按空仓迁移（物品视为丢失，保留旧键可人工找回）");
  }

  const ownerKey =
    typeof raw.ownerName === "string" && raw.ownerName.trim().length > 0 ? playerKey(raw.ownerName.trim()) : null;
  if (ownerKey === null) notices.push("无主人，迁移后仅管理员可管理（首次操作可认领，FR-A1）");

  const record: BotRecord = {
    botId: ctx.botId,
    name,
    ownerKey,
    dimensionId: dimensionFromPoint,
    home,
    respawnPoint,
    workMode: workMode ?? "none",
    switches: {
      sneaking: raw.isSneaking === true,
      autoRespawn: hasRespawnTag,
      ownerDownOffline: false, // 记录级不覆盖，走全局默认
    },
    tags: [], // 旧标签全部被消费；v2 业务标签空集起步
    inventoryRef: { regionId },
    experience: migrateExperience(raw.experience, notices),
    effects: migrateEffects(raw.effects, notices),
    followTarget: null,
    workChestId: null,
    fixedFishingSpot: null,
    lockFishingSpot: false,
    raidVictories: 0, // 旧格式没有胜场字段，迁移后从 0 起算
    // 在线声明与死亡标注原样搬运——重启归一在启动对账（残留在线声明一律落离线）
    declaredOnline: raw.online === true,
    // 老档没有 resumeOnRestart 字段：按当时是否在线推断（在线过→重启后恢复）
    resumeOnRestart: raw.online === true,
    deathMark: raw.death === true,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  if (raw.spawnMode !== undefined) notices.push("spawnMode（旧生成模式）已废弃，不迁移");
  if (raw.woodcutMode !== undefined) notices.push("woodcutMode（旧砍树子模式）新版已移除砍树能力，不迁移");
  if (raw.controllerId !== undefined) notices.push("controllerId（旧体态控制会话）新版已移除该能力，不迁移");
  if (raw.deathPoint) notices.push("deathPoint 不迁移（死亡点仅展示用，v2 由上线提示替代）");
  if (raw.actionIntervalTicks !== undefined)
    notices.push("actionIntervalTicks（旧动作间隔）新版节拍写死，不迁移（用户规格 2026-09-28）");
  return { ok: true, record, binding, notices };
}

/**
 * 幂等跳过判定：旧名规范化后若已在 mp:name:* 索引中则跳过。
 * @param nameIndex - 现名索引（规范化名 → botId）
 * @param legacyName - 旧记录名
 * @returns 是否跳过
 */
export function shouldSkipLegacy(nameIndex: ReadonlyMap<string, number>, legacyName: string): boolean {
  return nameIndex.has(normalizeBotName(legacyName));
}

// ─── 旧全局配置键迁移 ──────────────────────────────────────────

/** 旧全局配置 DP 键（存 ModConfig JSON） */
export const LEGACY_CONFIG_KEY = "mockplayer:config";

/**
 * 旧 ModConfig → v2 GlobalConfig 形状（逐字段防御）：
 * - defaultQuota/defaultOnlineQuota → quotas.create/online（非负整数，缺省落 v2 默认）；
 * - quotas/onlineQuotas 逐玩家覆盖 → perPlayer.playerKey；
 * - enabledWorkModes → 全量布尔表：显式 true 才启用，缺省全禁；
 * - menuTriggerItemId：null=关信物仅命令；非选项表物品回退默认木棍；
 * - safeCooldownSeconds / auxTickingRadius：v2 无此字段——报备丢弃。
 * @param raw - 旧配置 JSON.parse 产物
 * @returns v2 形状配置与报备列表
 */
export function migrateLegacyConfig(raw: unknown): { value: Record<string, unknown>; notices: string[] } {
  const notices: string[] = [];
  const s = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    notices.push("旧配置形状非法，按空配置迁移（全默认）");
  const num = (v: unknown, fb: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fb;

  const perPlayer: Record<string, { create?: number; online?: number }> = {};
  const collect = (src: unknown, field: "create" | "online"): void => {
    if (typeof src !== "object" || src === null || Array.isArray(src)) return;
    for (const [name, v] of Object.entries(src as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      (perPlayer[playerKey(name)] ??= {})[field] = Math.max(0, Math.floor(v));
    }
  };
  collect(s.quotas, "create");
  collect(s.onlineQuotas, "online");

  const adminKeys: string[] = Array.isArray(s.admins)
    ? s.admins.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => playerKey(a))
    : [];

  const legacyEnabled = new Map<WorkMode, boolean>();
  const enabledRaw =
    typeof s.enabledWorkModes === "object" && s.enabledWorkModes !== null && !Array.isArray(s.enabledWorkModes)
      ? (s.enabledWorkModes as Record<string, unknown>)
      : undefined;
  if (enabledRaw) {
    for (const [k, v] of Object.entries(enabledRaw)) {
      if (typeof v !== "boolean") continue; // 布尔白名单
      const m = normalizeLegacyWorkMode(k);
      if (m === undefined) notices.push(`旧工作模式表未知键 ${k} 丢弃`);
      else legacyEnabled.set(m, v);
    }
  } else {
    notices.push("旧配置无工作模式启用表，未点名模式按新默认表启用（缺59）");
  }
  // 启用表起点取新默认（全部模式默认启用），旧档显式布尔值逐项覆盖：
  // 旧档点名关掉的仍关，从没点名的不再被 heavy 默认关口径压住；盖上版本戳后
  // 读盘侧不再触发整表重置（两路对启用表的处理只剩一套口径）。
  const workModeEnabled: Record<string, boolean> = { ...defaultEnabledModes() };
  for (const mode of Object.keys(workModeEnabled) as WorkMode[]) {
    const legacy = legacyEnabled.get(mode);
    if (legacy !== undefined) workModeEnabled[mode] = legacy;
  }

  let tokenItem: { enabled: boolean; typeId: string } = { enabled: true, typeId: DEFAULT_TOKEN_ITEM };
  if (s.menuTriggerItemId === null) {
    tokenItem = { enabled: false, typeId: DEFAULT_TOKEN_ITEM };
  } else if (typeof s.menuTriggerItemId === "string") {
    if (TOKEN_ITEM_OPTIONS.some((o) => o.typeId === s.menuTriggerItemId)) {
      tokenItem = { enabled: true, typeId: s.menuTriggerItemId };
    } else {
      notices.push(`旧信物 ${s.menuTriggerItemId} 不在选项表，回退默认木棍`);
    }
  }

  if (s.safeCooldownSeconds !== undefined) notices.push("safeCooldownSeconds（安全上下线冷却）v2 无对位，未迁移");
  if (s.autoOnlineOnRestart !== undefined)
    notices.push("autoOnlineOnRestart（重启征询自动上线）新版已移除该功能，未迁移（重启后假人一律保持离线）");
  const auxTickingRadius = normalizeAuxTickingRadius(s.auxTickingRadius);
  if (s.auxTickingRadius !== undefined && s.auxTickingRadius !== auxTickingRadius)
    notices.push(`auxTickingRadius 旧值 ${String(s.auxTickingRadius)} 非 0/4/6/8，按模拟${auxTickingRadius}迁入`);

  return {
    value: {
      quotas: {
        create: num(s.defaultQuota, DEFAULT_CREATE_QUOTA),
        online: num(s.defaultOnlineQuota, DEFAULT_ONLINE_QUOTA),
        perPlayer,
      },
      workModeEnabled,
      workModePolicyVersion: WORK_MODE_POLICY_V_ALL_ON,
      ownerDownOfflineDefault: typeof s.ownerOfflineAutoOffline === "boolean" ? s.ownerOfflineAutoOffline : false,
      adminKeys,
      tokenItem,
      auxTickingRadius,
      debugLog: false,
    },
    notices,
  };
}

// ─── 旧 DP JSON 物品子键 ────────────────────────────────────────

/** 旧物品子键匹配 */
const LEGACY_ITEM_KEY_RE = /^mockplayer:players:(.+):(inv|equip):(.+)$/;

/** 旧物品键解析产物：name 必有；slot 缺 = 槽位标记越界（仅清扫路） */
export interface LegacyItemKey {
  name: string;
  slot?: { kind: "inv"; slot: number } | { kind: "equip"; slot: EquipSlotName };
}

/** 解析 `mockplayer:players:<name>:inv:<N>` / `:equip:<槽名>`（越界槽返回无 slot） */
export function parseLegacyItemKey(id: string): LegacyItemKey | undefined {
  const m = LEGACY_ITEM_KEY_RE.exec(id);
  if (!m) return undefined;
  const name = m[1]!;
  const token = m[3]!;
  if (m[2] === "inv") {
    const n = Number(token);
    if (Number.isInteger(n) && n >= 0 && n < INVENTORY_SIZE) return { name, slot: { kind: "inv", slot: n } };
    return { name };
  }
  if ((EQUIP_SLOT_NAMES as readonly string[]).includes(token)) {
    return { name, slot: { kind: "equip", slot: token as EquipSlotName } };
  }
  return { name };
}

/** 旧物品残留键判定：前缀 + `:inv:`/`:equip:` 子串 */
export function isLegacyItemResidueKey(id: string): boolean {
  return id.startsWith(LEGACY_DP_PREFIX) && (id.includes(":inv:") || id.includes(":equip:"));
}

/** 旧序列化物品（engine 解码入仓的输入形状） */
export interface LegacySerializedItem {
  typeId: string;
  amount?: number;
  nameTag?: string;
  keepOnDeath?: boolean;
  lockMode?: string;
  lore?: string[];
  canDestroy?: string[];
  canPlaceOn?: string[];
  damage?: number;
  unbreakable?: boolean;
  enchantments?: { id: string; level: number }[];
  potionEffectType?: string;
  potionDeliveryType?: string;
  color?: { red: number; green: number; blue: number };
}

/** 旧物品 JSON 最低可解析判定：仅认 typeId 为非空 string */
export function isSerializedItemShape(value: unknown): value is LegacySerializedItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { typeId?: unknown };
  return typeof v.typeId === "string" && v.typeId.length > 0;
}
