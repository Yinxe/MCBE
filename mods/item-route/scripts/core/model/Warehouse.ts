// ─── 概念级仓库与成员 ────────────────────────────────────
// 仓库 = 一个维度区域 + 成员 + 设置 + 该区域内注册的逻辑容器。
// 纯数据/类型 + 默认值；不感知 MC，由 core 的 WarehouseService 管理 CRUD、
// mc 层负责把真实方块扫描/注册进 `containers`。
// 权限模型（配合 services/MemberService.ts）：owner > member，
// 命令/UI 统一经 `MemberService.can()` 判定，替代 v1 的 OP 二元判断。
import type { Container } from "./Container";
import type { ContainerRole } from "./Container";
import type { ContainerId, PlayerName, WarehouseId } from "./types";
import { DEFAULT_ENABLED_FAMILIES } from "../data/item-families";

/** 成员角色：仓库仅两类参与者 —— owner（全权限）/ member（管理），不再有访客 */
export type MemberRole = "owner" | "member";

export interface Member {
  playerName: PlayerName;
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
  /** 仓库运转开关：false 时该仓完全停运（interval 不再处理任何输入槽） */
  routingEnabled: boolean;
  /** 自动整理开关：仅路由成功放入后、目标混乱度超 autoSortThreshold 才触发整理 */
  sortingEnabled: boolean;
  /** 单仓处理速度（tick 间隔） */
  processingSpeed: number;
  /** 容量预警黄色阈值 */
  warningThreshold: number;
  /** 自动整理触发阈值（0-1，v1 混乱度模型；超过即触发） */
  autoSortThreshold: number;
  /** 持久边界光幕：区域 12 棱持续显示粒子线框（附近玩家持信物可见；v1 showBoundary 口径） */
  showBoundary: boolean;
  /** 容量预警全局开关（默认开；关闭后该仓不再触发任何预警消息） */
  warningEnabled: boolean;
  /** 新放置容器的默认角色（漏斗仍强制 input） */
  defaultContainerRole: ContainerRole;
  /** 新放置容器的默认启用 */
  defaultContainerEnabled: boolean;
  /**
   * 仓库级启用的同族族 ID[]。新建仓库默认启用 DEFAULT_ENABLED_FAMILIES（常用族）；
   * FamilyConfigMenu 逐族增减落此。空数组 = 未启用任何族（旧档缺省合并即空）。
   */
  enabledFamilies: string[];
  /** 仓库级黑名单 typeId[]：这些物品永不进入本仓库（输入遇必阻塞、不入索引路由）；空 = 不限 */
  blacklist: string[];
}

export function createDefaultSettings(): WarehouseSettings {
  return {
    routingEnabled: true,
    sortingEnabled: true,
    processingSpeed: 8,
    warningThreshold: 0.9,
    autoSortThreshold: 0.4,
    showBoundary: false,
    warningEnabled: true,
    defaultContainerRole: "single",
    defaultContainerEnabled: true,
    // 同族默认启用常用族（DEFAULT_ENABLED_FAMILIES）；玩家可在同族配置里逐族增减。
    // → 旧档/新仓缺字段合并后即空 = 全关（保留"未配置即不启用"的兼容语义）。
    enabledFamilies: [...DEFAULT_ENABLED_FAMILIES],
    blacklist: [],
  };
}

/**
 * 是否启用某族：`enabledFamilies` 含该族 → 启用；不含/缺省空 → 禁用。
 * 新仓默认启用 DEFAULT_ENABLED_FAMILIES（常用族），玩家按需增减。
 * 见 WarehouseSettings.enabledFamilies 注释。
 */
export function isFamilyEnabled(settings: WarehouseSettings, familyId: string): boolean {
  return (settings.enabledFamilies ?? []).includes(familyId);
}

/** 概念级仓库 */
export interface Warehouse {
  /**
   * 仓库 ID（`w@(min)-(max)@维度`）。**可迁移**：resize 改变区域时由
   * WarehouseService.updateArea 重算并迁移（见 onRebase）。以此区分"生成即定死"
   * 的纯身份——此 ID 是定位式/可读式，随区域变化而更新是设计意图。
   */
  id: WarehouseId;
  displayName: string;
  ownerName: PlayerName;
  members: Member[];
  area: WarehouseArea;
  settings: WarehouseSettings;
  readonly containers: Map<string, Container>;
  /** 启用输入容器（role=input 且 enabled）的维护镜像。
   * 由 ContainerRegistry 各函数与 `containers` 同写同删，Scheduler 每轮取输入零过滤
   * （输入通常仅 1~3 个，不遍历全仓容器）。 */
  readonly inputs: Map<string, Container>;
  /**
   * **待补注册的容器 id（运行时内存，不持久化；可选字段，缺省按空处理）**：容器加载/激活时若其
   * 所在区块未加载而被跳过，记为 pending → 主循环按固定节律对它们逐个重试（区块加载则注册；
   * 确认空气则移除注册表）。与 `containers` 生命周期一致：unload 即清；重启后随注册表重建。
   * 读取用 `pendingReloadsOf(warehouse)`（缺省空 Set，不强制每个构造点实现）。
   */
  readonly pendingReloads?: Set<ContainerId>;
}

/** 取仓库待补容器集（字段缺省按空处理——旧字面量/测试未声明的兼容；返回可写引用） */
export function pendingReloadsOf(wh: Warehouse): Set<ContainerId> {
  if (wh.pendingReloads === undefined) {
    // 运行时此处才会实际写入；用 `as` 给缺省字段惰性建集（后续 add 落回 wh，统一状态）
    (wh as { pendingReloads?: Set<ContainerId> }).pendingReloads = new Set();
  }
  return wh.pendingReloads as Set<ContainerId>;
}
