// ─── 核心 ID 类型与概念坐标 ──────────────────────────────
// 全部 ID 均以 string 承载（避免在 core 层依赖 MC 的 UUID/枚举类型），
// 保证 core 零 MC 依赖、可在 node 下单测。
export type ItemId = string;
export type ContainerId = string;
export type WarehouseId = string;
export type PlayerId = string;

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
