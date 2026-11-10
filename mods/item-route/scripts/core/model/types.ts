// ─── 核心 ID 类型与概念坐标 ──────────────────────────────
// 全部 ID 均以 string 承载（避免在 core 层依赖 MC 的 UUID/枚举类型），
// 保证 core 零 MC 依赖、可在 node 下单测。
// ⚠️ 玩家标识：成员/归属用**玩家唯一名称**（gamer-tag，服务器内唯一）而非 UUID——
// 对玩家可见、可手工输入（如 /ir:add_member 名称）；运行时会话键（选区/防抖）仍可用
// player.id，但**持久化的成员身份一律用名称**。
export type ItemId = string;
export type ContainerId = string;
export type WarehouseId = string;
/** 玩家唯一名称（gamer-tag；用于仓库成员/归属等**持久化**身份） */
export type PlayerName = string;

/** 概念坐标（不含维度——维度归属由仓库区域承载，避免污染纯几何函数） */
export interface Location {
  x: number;
  y: number;
  z: number;
}

/** 生成坐标的稳定字符串键，用于去重/比对（如双箱 occupiedLocations 反查） */
export function locationKey(loc: Location): string {
  return `${loc.x},${loc.y},${loc.z}`;
}
