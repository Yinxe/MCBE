// ─── 命令依赖（DI 装配注入）：命令回调访问的服务与数据 ──
import type { WarehouseService } from "../../core/services/WarehouseService";
import type { MemberService } from "../../core/services/MemberService";
import type { StatsService } from "../../core/stats/StatsService";
import type { RouteService } from "../../core/services/RouteService";
import type { OrganizeService } from "../../core/services/OrganizeService";
import type { ItemIndex } from "../../core/index/ItemIndex";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import type { ContainerId } from "../../core/model/types";
import type { McModConfig } from "../storage/McModConfig";
import type { McContainerFactory } from "../adapters/McContainerFactory";
import type { SelectionSessionStore } from "../interaction/SelectionSessionStore";
import type { EventBus } from "../../core/events/DomainEvents";

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
}