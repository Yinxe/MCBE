// ─── 核心数据类型与常量 ─────────────────────────────────────────
//
// 本文件不 import 任何 @minecraft 模块:位置用本文件自带的 Position,
// 而不是 @minecraft/server 的 Vector3。这样 core 层可以被 node --test 直接覆盖。

/** 三维坐标。与 Vector3 结构兼容,但不依赖脚本 API。 */
export interface Position {
  x: number;
  y: number;
  z: number;
}

/** 传送点分类。顺序即表单下拉框顺序。 */
export const WAYPOINT_CATEGORIES = [
  "家",
  "资源点",
  "生电",
  "遗迹",
  "群系",
  "其他",
] as const;

export type WaypointCategory = (typeof WAYPOINT_CATEGORIES)[number];

/** 分类无法识别时的兜底值。 */
export const FALLBACK_CATEGORY: WaypointCategory = "其他";

/** 单个传送点。字段名与上游 DynamicProperty 载荷保持一致。 */
export interface WaypointRecord {
  id: string;
  name: string;
  category: WaypointCategory;
  note: string;
  /** 自动检测的群系中文名,检测失败时不写该字段 */
  biomeInfo?: string;
  location: Position;
  dimensionId: string;
  createdAt: number;
  teleportCount: number;
  isPinned: boolean;
  isPublic: boolean;
  ownerId: string;
  ownerName: string;
}

/** 死亡点。 */
export interface DeathPointRecord {
  id: string;
  deathTime: number;
  location: Position;
  dimensionId: string;
}

/** 每人保留的死亡点上限,超出后丢弃最旧的。 */
export const MAX_DEATH_POINTS = 10;

/** 单个玩家的存档。 */
export interface PlayerData {
  waypoints: WaypointRecord[];
  deathPoints: DeathPointRecord[];
}

/** 构造空存档。 */
export function createEmptyPlayerData(): PlayerData {
  return { waypoints: [], deathPoints: [] };
}

/**
 * 生成唯一 ID。
 *
 * 脚本 API 没有 crypto 模块,沿用上游做法:时间戳 36 进制 + 随机数片段。
 * 两个入参可注入,便于单测断言格式而不依赖真实时钟。
 */
export function generateId(
  now: number = Date.now(),
  random: number = Math.random(),
): string {
  const timePart = Math.floor(now).toString(36);
  const randomPart = random.toString(36).slice(2, 10);
  return timePart + randomPart;
}

/** 传送请求方向。 */
export type TeleportRequestType = "tpa" | "tphere";

/** 一条待处理的传送请求。 */
export interface TeleportRequest {
  /** 请求方玩家 ID */
  fromId: string;
  /** 请求方玩家名 */
  fromName: string;
  /** 目标方玩家 ID */
  toId: string;
  type: TeleportRequestType;
  createdAt: number;
}

/** 请求有效期,超时后自动作废。 */
export const TELEPORT_REQUEST_TIMEOUT_MS = 60_000;

/** 模组配置。 */
export interface ModConfig {
  /** 单人最大传送点数,允许范围 10–100 */
  maxWaypointsPerPlayer: number;
  /** 是否允许把传送点设为公共 */
  publicWaypointEnabled: boolean;
}

/** 配置默认值。 */
export const DEFAULT_CONFIG: ModConfig = {
  maxWaypointsPerPlayer: 30,
  publicWaypointEnabled: true,
};

/** 单人传送点上限的可调范围。 */
export const MIN_WAYPOINTS_PER_PLAYER = 10;
export const MAX_WAYPOINTS_PER_PLAYER = 100;
