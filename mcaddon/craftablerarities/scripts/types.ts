/**
 * ============================================================================
 * types — 集中式类型定义
 *
 * 所有 Add-on 使用的业务类型放在此处。
 * 原则：单个文件、按领域分段、每个类型有中文 JSDoc 说明。
 * ============================================================================
 */

// ── ID 类型 ──────────────────────────────────────────────────────
/** 实体 ID（字符串格式） */
export type EntityId = string;

/** 维度 ID（如 "minecraft:overworld"） */
export type DimensionId = string;

/** 坐标键格式（"dimensionId|x|y|z"） */
export type LocationKey = string;

// ── 核心数据模型 ─────────────────────────────────────────────────
/** 实体元数据 */
export interface EntityMeta {
  id: EntityId;
  name: string;
  createdAt: number;
}

/** 实体完整数据 */
export interface EntityData extends EntityMeta {
  // 添加您的业务字段
}

// ── 常量与枚举 ───────────────────────────────────────────────────
/** 配置键常量 */
export const CONFIG_KEYS = {
  DEBUG_MODE: "debugMode",
  MAX_COUNT: "maxCount",
} as const;

// ── 工具类型 ─────────────────────────────────────────────────────
/** 操作结果（ok/error 模式） */
export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

/** JSON 可序列化值 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
