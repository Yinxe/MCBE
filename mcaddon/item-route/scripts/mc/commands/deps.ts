// ─── 命令依赖（DI 装配注入）：命令回调访问的服务与数据 ──
import type { WarehouseService } from "../../core/services/WarehouseService";
import type { MemberService } from "../../core/services/MemberService";
import type { StatsService } from "../../core/stats/StatsService";
import type { RouteService } from "../../core/services/RouteService";
import type { OrganizeService } from "../../core/services/OrganizeService";
import type { ItemIndex } from "../../core/index/ItemIndex";
import type { Warehouse } from "../../core/model/Warehouse";
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
  index: ItemIndex;
  config: McModConfig;
  /** 选区会话（信物交互与建仓流程共享） */
  session: SelectionSessionStore;
  /** 当前已加载仓库（按显示名解析） */
  loadedWarehouses: () => Warehouse[];
  factory: McContainerFactory;
  /** 容器注册后持久化容器注册表 */
  persistContainers: (warehouse: Warehouse) => void;
}