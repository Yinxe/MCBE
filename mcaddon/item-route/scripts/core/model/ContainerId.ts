// ─── 容器 ID 生成与主坐标（纯函数，可单测） ──────────────
// 容器 ID = `c@x,y,z`（主坐标）。主坐标在双箱合并时取 (x,y,z) 排序最小者，
// 保证：同一双箱无论从哪半开始创建，ID 都稳定一致；拆掉主半箱后能重定到幸存半箱
// （见 McEventBridge 拆箱重定逻辑），避免"拆主半后 ID 悬空 + 新放容器撞 ID"。
import type { ContainerId, Location } from "./types";

/** 由主坐标生成容器 ID */
export function containerIdOf(loc: Location): ContainerId {
  return `c@${loc.x},${loc.y},${loc.z}`;
}

/** 从坐标列表取主坐标（(x,y,z) 字典序最小者；空列表返回 undefined） */
export function primaryLocationOf(locations: Location[]): Location | undefined {
  if (locations.length === 0) return undefined;
  return [...locations].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)[0];
}

/** 解析容器 ID 的主坐标（供比对"该容器是否仍以某坐标为主"） */
export function parseContainerId(id: ContainerId): Location | undefined {
  const m = /^c@(-?\d+),(-?\d+),(-?\d+)$/.exec(id);
  if (!m) return undefined;
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
}

/** 容器 ID 是否指向给定坐标（合并/拆箱时判断主半是否被破坏） */
export function containerIdPointsTo(id: ContainerId, loc: Location): boolean {
  const primary = parseContainerId(id);
  return primary !== undefined && primary.x === loc.x && primary.y === loc.y && primary.z === loc.z;
}