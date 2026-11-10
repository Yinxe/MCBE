// ─── 命令依赖（DI 装配注入）：命令回调访问的服务与数据 ──
import type { Player } from "@minecraft/server";
import type { WarehouseService } from "../../core/services/WarehouseService";
import type { MemberService } from "../../core/services/MemberService";
import type { StatsService } from "../../core/stats/StatsService";
import type { RouteService } from "../../core/services/RouteService";
import type { OrganizeService, OrganizeResult } from "../../core/services/OrganizeService";
import type { ItemIndex } from "../../core/index/ItemIndex";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import type { ContainerId } from "../../core/model/types";
import type { McModConfig } from "../storage/McModConfig";
import type { McContainerFactory } from "../adapters/McContainerFactory";
import type { SelectionSessionStore } from "../interaction/SelectionSessionStore";
import type { EventBus } from "../../core/events/DomainEvents";

/** 持久边界控制门面（showBoundary 设置启停；装配层实例化为 PersistentBoundary + 玩家持信物守卫） */
export interface BoundaryControl {
  setEnabled(warehouse: Warehouse, enabled: boolean): void;
}

/** 背包整理结果：region 作为 formatOrganizeResult 的容器名；note 为阶段提示（可选） */
export interface PlayerInventoryResult {
  /** 本次整理的区间名：背包主栏 / 背包快捷栏 / 背包（两区已整齐） */
  region: string;
  result: OrganizeResult;
  /** 阶段提示（如"快捷栏需再整理一次"）；无则空 */
  note?: string;
}

export interface CommandDeps {
  bus: EventBus;
  members: MemberService;
  warehouses: WarehouseService;
  stats: StatsService;
  route: RouteService;
  organize: OrganizeService;
  /** 按仓库解析其索引（隔离：取该仓当前加载的，未激活返回 undefined） */
  resolveIndex: (warehouseId: string) => ItemIndex | undefined;
  config: McModConfig;
  /** 选区会话（信物交互与建仓流程共享） */
  session: SelectionSessionStore;
  /** 当前已加载仓库（按显示名解析） */
  loadedWarehouses: () => Warehouse[];
  factory: McContainerFactory;
  /** 单容器注册表属性/几何持久化（**最小单位**：只写该容器自己的键；oldId=重定 ID 时清旧键） */
  persistContainer: (warehouse: Warehouse, container: Container, oldId?: ContainerId) => void;
  /** 容器移除持久化：清该容器自己的键（索引由 persistContainerIds 随结构变更同步） */
  removeContainer: (warehouse: Warehouse, containerId: ContainerId) => void;
  /** 同步该仓容器 ID 索引（容器新增/移除/重定 ID 后调用；枚举/清理/删除用） */
  persistContainerIds: (warehouse: Warehouse) => void;
  /** 按需加载该仓容器（启动不预载，菜单/命令/交互访问前调用；已加载幂等返回） */
  ensureContainersLoaded: (warehouse: Warehouse) => void;
  /** 持久边界光幕控制（showBoundary 设置启停；装配层注入 guard=附近玩家持信物） */
  boundary: BoundaryControl;
  /** 背包整理（2 阶段：优先主栏 9-35，归零后转快捷栏 0-8；返回整理区间与阶段提示） */
  organizeInventory: (player: Player) => PlayerInventoryResult;
}
