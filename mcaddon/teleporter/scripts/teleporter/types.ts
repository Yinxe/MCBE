import { Vector3 } from "@minecraft/server";

// ─── 枚举 ──────────────────────────────────────────────────────────

/** 传送点分类 */
export const WAYPOINT_CATEGORIES = [
  "家",
  "资源点",
  "生电",
  "遗迹",
  "群系",
  "其他",
] as const;

export type WaypointCategory = (typeof WAYPOINT_CATEGORIES)[number];

// ─── 传送点 ────────────────────────────────────────────────────────

export interface WaypointRecord {
  /** 唯一 ID (时间戳 + 随机数) */
  id: string;
  /** 传送点名称 */
  name: string;
  /** 分类 */
  category: WaypointCategory;
  /** 自定义备注 */
  note: string;
  /** 自动检测的群系名称（如 "平原"、"沙漠"、"深暗之域"） */
  biomeInfo?: string;
  /** 坐标 */
  location: Vector3;
  /** 维度 ID */
  dimensionId: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 传送次数 */
  teleportCount: number;
  /** 是否置顶（优先级高于次数排序） */
  isPinned: boolean;
  /** 是否公共传送点 */
  isPublic: boolean;
  /** 所有者玩家 ID */
  ownerId: string;
  /** 所有者玩家名（显示用） */
  ownerName: string;
}

// ─── 死亡点 ────────────────────────────────────────────────────────

export interface DeathPointRecord {
  /** 唯一 ID */
  id: string;
  /** 死亡时间戳 */
  deathTime: number;
  /** 死亡坐标 */
  location: Vector3;
  /** 维度 ID */
  dimensionId: string;
}

export const MAX_DEATH_POINTS = 10;

// ─── 玩家数据 ──────────────────────────────────────────────────────

export interface PlayerData {
  waypoints: WaypointRecord[];
  deathPoints: DeathPointRecord[];
}

export function createEmptyPlayerData(): PlayerData {
  return { waypoints: [], deathPoints: [] };
}

/**
 * 生成唯一 ID（用于传送点和死亡记录）。
 * Minecraft Script API 无 crypto 模块，使用时间戳 + 随机数。
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ─── 传送请求 ──────────────────────────────────────────────────────

export type TeleportRequestType = "tpa" | "tphere";

export interface TeleportRequest {
  /** 请求方玩家 ID */
  fromId: string;
  /** 请求方玩家名 */
  fromName: string;
  /** 目标方玩家 ID */
  toId: string;
  /** 请求类型 */
  type: TeleportRequestType;
  /** 创建时间戳 */
  createdAt: number;
}

export const TELEPORT_REQUEST_TIMEOUT_MS = 60_000; // 60 秒超时

// ─── 模组配置 ──────────────────────────────────────────────────────

export interface ModConfig {
  /** 单人最大传送点数 (10-100) */
  maxWaypointsPerPlayer: number;
  /** 是否允许启用公共传送点 */
  publicWaypointEnabled: boolean;
}

export const DEFAULT_CONFIG: ModConfig = {
  maxWaypointsPerPlayer: 30,
  publicWaypointEnabled: true,
};
