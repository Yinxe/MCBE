// ─── 概念级仓库与成员 ────────────────────────────────────
import type { Container } from "./Container";
import type { PlayerId, WarehouseId } from "./types";

/** 成员角色：owner 全权限 / member 管理 / visitor 只读 */
export type MemberRole = "owner" | "member" | "visitor";

export interface Member {
  playerId: PlayerId;
  role: MemberRole;
}

/** 仓库区域：维度 + 两角坐标 */
export interface WarehouseArea {
  dimension: string;
  corner1: { x: number; y: number; z: number };
  corner2: { x: number; y: number; z: number };
}

/** 仓库设置 */
export interface WarehouseSettings {
  sortingEnabled: boolean;
  /** 单仓处理速度（tick 间隔） */
  processingSpeed: number;
  /** 容量预警黄色阈值 */
  warningThreshold: number;
  /** 自动整理触发阈值（容器混乱度超过即触发） */
  autoSortThreshold: number;
}

export function createDefaultSettings(): WarehouseSettings {
  return {
    sortingEnabled: true,
    processingSpeed: 8,
    warningThreshold: 0.9,
    autoSortThreshold: 3,
  };
}

/** 概念级仓库 */
export interface Warehouse {
  readonly id: WarehouseId;
  displayName: string;
  ownerId: PlayerId;
  members: Member[];
  area: WarehouseArea;
  settings: WarehouseSettings;
  readonly containers: Map<string, Container>;
}