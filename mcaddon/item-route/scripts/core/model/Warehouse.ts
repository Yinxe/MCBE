// ─── 概念级仓库与成员 ────────────────────────────────────
// 仓库 = 一个维度区域 + 成员 + 设置 + 该区域内注册的逻辑容器。
// 纯数据/类型 + 默认值；不感知 MC，由 core 的 WarehouseService 管理 CRUD、
// mc 层负责把真实方块扫描/注册进 `containers`。
// 权限模型（配合 services/MemberService.ts）：owner > member > visitor，
// 命令/UI 统一经 `MemberService.can()` 判定，替代 v1 的 OP 二元判断。
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