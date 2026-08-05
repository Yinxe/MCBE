// ─── 容器/仓库 ID 生成与主坐标（纯函数，可单测） ──────────
// 容器 ID = `c@(x,y,z)@维度`；仓库 ID = `w@(min)-(max)@维度`（括号风格统一）。
// **带维度后缀**：同一批发坐标在不同维度会各自成为唯一 ID，避免跨维重叠
// （否则 overworld 与 nether 的容器在全局统计缓存等以 ID 为键处会串味）。
// 容器主坐标 = 双箱合并时两半 (x,y,z) 最小者：保证同双箱不论从哪半开始创建 ID 一致，
// 拆主半后能重定到幸存半（见 McEventBridge 拆箱重定）；维度取仓库所属维度。
// 仓库 ID 由**初始归一化区域**生成（角点乱序自动纠正）。⚠️ 随 resize 迁移：
// updateArea 改变区域后重算并迁移（见 WarehouseService.updateArea / onRebase），
// 非"生成即定死"——是定位式/可读式 ID，随区域变化更新为设计意图。
import type { ContainerId, WarehouseId, Location } from "./types";
import type { WarehouseArea } from "./Warehouse";

/** 由主坐标 + 维度生成容器 ID */
export function containerIdOf(loc: Location, dimension: string): ContainerId {
  return `c@(${loc.x},${loc.y},${loc.z})@${dimension}`;
}

/** 从坐标列表取主坐标（(x,y,z) 字典序最小者；空列表返回 undefined） */
export function primaryLocationOf(locations: Location[]): Location | undefined {
  if (locations.length === 0) return undefined;
  return [...locations].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)[0];
}

/** 解析容器 ID 的主坐标（含维度） */
export function parseContainerId(id: ContainerId): { loc: Location; dimension: string } | undefined {
  const m = /^c@\((-?\d+),(-?\d+),(-?\d+)\)@(.+)$/.exec(id);
  if (!m) return undefined;
  return {
    loc: { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) },
    dimension: m[4]!,
  };
}

/** 容器 ID 是否指向给定坐标+维度（合并/拆箱判断主半是否被破坏） */
export function containerIdPointsTo(id: ContainerId, loc: Location, dimension: string): boolean {
  const parsed = parseContainerId(id);
  return (
    parsed !== undefined &&
    parsed.dimension === dimension &&
    parsed.loc.x === loc.x &&
    parsed.loc.y === loc.y &&
    parsed.loc.z === loc.z
  );
}

/** 由归一化仓库区域生成仓库 ID（角点乱序自动纠正） */
export function warehouseIdOf(area: WarehouseArea): WarehouseId {
  const minX = Math.min(area.corner1.x, area.corner2.x);
  const maxX = Math.max(area.corner1.x, area.corner2.x);
  const minY = Math.min(area.corner1.y, area.corner2.y);
  const maxY = Math.max(area.corner1.y, area.corner2.y);
  const minZ = Math.min(area.corner1.z, area.corner2.z);
  const maxZ = Math.max(area.corner1.z, area.corner2.z);
  return `w@(${minX},${minY},${minZ})-(${maxX},${maxY},${maxZ})@${area.dimension}`;
}