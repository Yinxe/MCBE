// ─── 共享类型和常量 ────────────────────────────────────

import { Vector3, Vector2 } from "@minecraft/server";

// ─── 常量 ──────────────────────────────────────────────

export const TAG_PREFIX = "mockplayer:tag:";
export const BOT_TAG = `${TAG_PREFIX}bot`;
export const DP_PREFIX = "mockplayer:players:";

// ─── 类型定义 ──────────────────────────────────────────

export interface TagDef {
  /** 显示名 */
  label: string;
  /** tag 值（含前缀） */
  value: string;
}

/** 点位状态：完整的位置、维度、朝向、视角 */
export interface PositionState {
  location: Vector3;
  dimension: string;
  rotation: Vector2;
  lookTarget: Vector3;
}

/** 假人持久化记录 */
export interface BotRecord {
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
