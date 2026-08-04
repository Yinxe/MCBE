// ─── 核心 ID 类型与概念坐标 ──────────────────────────────
export type ItemId = string;
export type ContainerId = string;
export type WarehouseId = string;
export type PlayerId = string;

/** 概念坐标（不含维度——维度归属由仓库区域承载） */
export interface Location {
  x: number;
  y: number;
  z: number;
}

/** 生成坐标的稳定字符串键，用于去重/比对 */
export function locationKey(loc: Location): string {
  return `${loc.x},${loc.y},${loc.z}`;
}