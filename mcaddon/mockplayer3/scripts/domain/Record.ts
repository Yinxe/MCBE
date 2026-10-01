// ─── BotRecord：假人档案（domain 纯逻辑） ────────────────
// 记录跨下线/重启持久存在；运行时状态在 Session（Session.ts）。
// 存储寻址一律 botId，name 只是显示属性与 mp:name:<n> 反查索引。
// 注视是租约不持久化；home 只存身体朝向 yaw/pitch。

import type { Vec3 } from "./Coords";
import type { HarvestKindId } from "./HarvestRules";
import { normalizeBotName, validateBotName } from "./Identity";

// ─── 工作模式与开关 ──

/** 采集模式族：对象即模式——每种采集对象一个独立 WorkMode */
export type HarvestMode = `harvest_${HarvestKindId}`;

/** WorkMode 枚举唯一真源（目录元数据见 Catalog.ts） */
export type WorkMode =
  "none" | "wander" | "mine" | "place" | "attack" | "fishing" | "raid" | "follow" | "vault" | HarvestMode;

/** 与 workMode 正交的独立开关 */
export interface BotSwitches {
  /** 潜行（持久化跨上下线） */
  sneaking: boolean;
  /** 死亡原地自动重生 */
  autoRespawn: boolean;
  /** 主人下线联动下线（记录级覆盖全局默认） */
  ownerDownOffline: boolean;
}

// ─── 点位与经验 ──

/** 锚点点位：位置 + 身体朝向（yaw/pitch 平铺存法沿用 MC 角语义，弧度制不在此转换） */
export interface HomePoint {
  position: Vec3;
  yaw: number;
  pitch: number;
}

/** 重生点：平铺 DimensionLocation 语义（F-08——setSpawnPoint 需平铺参数） */
export interface RespawnPoint {
  position: Vec3;
  yaw: number;
  pitch: number;
  dimensionId: string;
}

/** 经验记录（等级 + 级内进度 + 累计总值；换算见 XpMath.ts） */
export interface ExperienceRecord {
  level: number;
  progress: number;
  totalXp: number;
}

/** 序列化效果（离线暂停、上线按剩余时长重施；流程性效果不入——raid 自管） */
export interface SerializedEffect {
  /** 含命名空间的效果 ID，如 "minecraft:speed" */
  id: string;
  /** 剩余时长（tick） */
  durationTicks: number;
  /** 等级（0 = I 级） */
  amplifier: number;
}

// ─── 物品仓引用 ──

/** 装备槽名（主手不进仓——持久化六槽：五甲+副手） */
export const EQUIP_SLOT_NAMES = ["head", "chest", "legs", "feet", "offhand"] as const;
export type EquipSlotName = (typeof EQUIP_SLOT_NAMES)[number];

/** 主背包格数（快捷栏 9 + 主背包 27） */
export const INVENTORY_SIZE = 36;

/** 假人实体标识标签（记录 tags 真源之外的引擎级身份副本，F-07 重放/实体解析判据） */
export const BOT_MARKER_TAG = "mockplayer3:bot";

/**
 * 记录内的物品仓引用：只存区域指针。
 * 槽位绑定表独立于记录（`mp:store:bind:<botId>`），与记录覆写解耦，
 * 防记录整体覆写丢失绑定导致物品失联。
 */
export interface InventoryRef {
  /** 存储区域 ID（"维度:X:Z"）；换锚点数据按此寻址 */
  regionId: string;
}

/**
 * 物品仓绑定表（DP 键 mp:store:bind:<botId>）：格/槽 → NBT 木桶 slotId。
 * 槽位一经绑定永不漂移（空槽写 structure_void 占位保持绑定）；无 key = 未绑定。
 */
export interface StorageBinding {
  /** 存储区域 ID（与 record.inventoryRef.regionId 一致，冗余存档防记录覆写期失联） */
  regionId: string;
  /** 背包格号 → slotId */
  inv: Record<string, number>;
  /** 装备槽名 → slotId */
  equip: Record<string, number>;
}

/** 绑定表形状守卫（DP 读回 unknown 判定；损坏绑定进缓存会导致写读错槽） */
export function isBindingShape(value: unknown): value is StorageBinding {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<StorageBinding>;
  if (typeof v.regionId !== "string" || v.regionId.length === 0) return false;
  return (
    isSlotMapShape(v.inv, (k) => Number(k) >= 0 && Number(k) < INVENTORY_SIZE) &&
    isSlotMapShape(v.equip, (k) => (EQUIP_SLOT_NAMES as readonly string[]).includes(k))
  );
}

function isSlotMapShape(value: unknown, keyOk: (key: string) => boolean): value is Record<string, number> {
  if (typeof value !== "object" || value === null) return false;
  for (const [k, sid] of Object.entries(value)) {
    if (!keyOk(k) || typeof sid !== "number" || !Number.isInteger(sid) || sid < 0) return false;
  }
  return true;
}

// ─── 记录本体 ──

/** 假人持久档案（DP 键 mp:bot:<botId>，schema v2） */
export interface BotRecord {
  /** 全局唯一、不复用的整数身份 */
  botId: number;
  /** 显示名（sim- 前缀），可改、不参与存储寻址 */
  name: string;
  /** 主人身份键（playerKey 口径）；null = 无主（仅管理员可管理） */
  ownerKey: string | null;
  /** 归属维度（最后已知/家点所在） */
  dimensionId: string;
  /** 家点：下线/出生锚点 + 身体朝向 */
  home: HomePoint;
  /** 重生点（实体侧双写义务见 F-08；null=用世界默认） */
  respawnPoint: RespawnPoint | null;
  /** 工作模式（显式单选） */
  workMode: WorkMode;
  /** 正交开关组 */
  switches: BotSwitches;
  /** 业务标签真源（实体上的只是易失副本，F-07） */
  tags: string[];
  /** 物品仓引用（创建时分配 region；槽位绑定在独立键 mp:store:bind:<botId>） */
  inventoryRef: InventoryRef;
  /** 经验快照（下线/死亡时点） */
  experience: ExperienceRecord;
  /** 效果快照（旧记录缺失 = 无效果） */
  effects: SerializedEffect[];
  /** 跟随目标玩家键（workMode=follow 时的关系持久化） */
  followTarget: string | null;
  /** 劫掠累计胜场（跨会话/重启持久累计；非劫掠假人恒 0） */
  raidVictories: number;
  /** 在线声明（启动对账归一依据）；唯一写者=上线/下线管线，运行时权威在状态机 */
  declaredOnline: boolean;
  /** 离线死亡标注（autoRespawn=false 死亡转离线时置真，仅展示/上线提示用，不参与状态机） */
  deathMark: boolean;
  /** 创建/更新时间戳（ms） */
  createdAt: number;
  updatedAt: number;
}

/** 创建记录入参（除 botId/name 外的初始态） */
export interface NewRecordParams {
  botId: number;
  rawName: string;
  ownerKey: string | null;
  home: HomePoint;
  dimensionId: string;
  regionId: string;
  now: number;
}

/**
 * 新建记录（含名字规范化与默认值；不校验配额/占用——由管线负责）。
 * @param params - 初始态
 * @returns 记录与名字校验错误（错误串或 undefined）；有错时记录仍返回（调用方判错丢弃）
 */
export function createRecord(params: NewRecordParams): { record: BotRecord; nameError?: string } {
  const name = normalizeBotName(params.rawName);
  const record: BotRecord = {
    botId: params.botId,
    name,
    ownerKey: params.ownerKey,
    dimensionId: params.dimensionId,
    home: params.home,
    respawnPoint: {
      position: params.home.position,
      yaw: params.home.yaw,
      pitch: params.home.pitch,
      dimensionId: params.dimensionId,
    },
    workMode: "none",
    switches: { sneaking: false, autoRespawn: false, ownerDownOffline: false },
    tags: [],
    inventoryRef: { regionId: params.regionId },
    experience: { level: 0, progress: 0, totalXp: 0 },
    effects: [],
    followTarget: null,
    raidVictories: 0,
    declaredOnline: false,
    deathMark: false,
    createdAt: params.now,
    updatedAt: params.now,
  };
  return { record, nameError: validateBotName(name) };
}

/**
 * 记录不变量校验（写前轻校验，返回中文错误串）。
 * @param record - 待校验记录
 */
export function validateRecord(record: BotRecord): string | undefined {
  const nameError = validateBotName(record.name);
  if (nameError) return nameError;
  if (!Number.isInteger(record.botId) || record.botId < 1) return "botId 必须为正整数";
  return undefined;
}

/** DP 读回 unknown 的合法记录结构守卫，防坏档入注册表 */
export function isBotRecordShape(value: unknown): value is BotRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<BotRecord>;
  return (
    typeof r.botId === "number" &&
    typeof r.name === "string" &&
    r.name.length > 0 &&
    typeof r.dimensionId === "string" &&
    Array.isArray(r.tags) &&
    typeof r.home === "object" &&
    r.home !== null
  );
}
