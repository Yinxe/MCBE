// ─── item-route 入口：4 Phase 启动装配（DI 组合根） ──
// 本文件是唯一的"组合根"：把 core 纯引擎 + mc 适配层按依赖方向手工装配，
// 顺序体现依赖关系（审查时先看这里建立全局心智模型）：
//   Phase 1 无状态基础设施 —— DP 后端 → ShardStore → McItemAdapter → McContainerFactory
//            → McIntervalScheduler
//   Phase 2 有状态业务 —— EventBus → ItemIndex → Router（策略+sorter）→ 三仓储
//            → WarehouseService（注入建仓限制）→ Scheduler（注入 onAutoSort）→ Stats
//            → Organizer/OrganizeService → RouteService
//   Phase 3 注册副作用 —— McEventBridge（世界事件→索引/统计/落盘）+ 信物交互
//            + 视觉订阅（SortEffects/BoundaryDisplay/WarningRelay）+ startup 注册 9 命令
//   Phase 4 延迟启动 —— world 完全加载后：从 DP 恢复仓库/容器/索引，注册调度，
//            未加载区块的容器留待事件/策略侧 reconcile 惰性补注册
// 依赖注入贯穿始终：各模块以构造函数/回调收依赖，不自行 new 外部服务（可测性）。
import { world, system } from "@minecraft/server";

// ── core ──
import { EventBus } from "../core/events/DomainEvents";
import { ItemIndex } from "../core/index/ItemIndex";
import { Router } from "../core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../core/routing/CandidateSorter";
import { Scheduler, type IndexLifecycle } from "../core/scheduling/Scheduler";
import { StatsService } from "../core/stats/StatsService";
import { Organizer } from "../core/organizing/Organizer";
import { OrganizeService } from "../core/services/OrganizeService";
import { WarehouseService } from "../core/services/WarehouseService";
import { MemberService } from "../core/services/MemberService";
import { RouteService } from "../core/services/RouteService";
import type { Warehouse } from "../core/model/Warehouse";
import type { Container } from "../core/model/Container";
import type { ContainerId } from "../core/model/types";
import { registerContainer } from "../core/model/ContainerRegistry";

// ── mc ──
import { DynamicPropertyStore } from "./storage/DynamicPropertyStore";
import { ShardStore } from "./storage/ShardStore";
import { McWarehouseStore } from "./storage/McWarehouseStore";
import { McIndexStore } from "./storage/McIndexStore";
import { McStatsStore } from "./storage/McStatsStore";
import { McModConfig } from "./storage/McModConfig";
import { McItemAdapter } from "./adapters/McItemAdapter";
import { McContainerFactory } from "./adapters/McContainerFactory";
import { McProximityChecker } from "./adapters/McProximityChecker";
import { McIntervalScheduler } from "./adapters/McIntervalScheduler";
import { McEventBridge } from "./adapters/McEventBridge";
import { SelectionSessionStore } from "./interaction/SelectionSessionStore";
import { registerToolInteraction } from "./interaction/ToolInteractionController";
import { registerAllCommands, type CommandDeps } from "./commands/index";
import { registerSortEffects } from "./effects/SortEffects";
import { registerBoundaryDisplay } from "./effects/BoundaryDisplay";
import { registerWarningRelay } from "./effects/WarningRelay";
import { registerNotifyRelay } from "./effects/NotifyRelay";
import { registerSubscriptions } from "./events/Subscriptions";
import { scanWarehouseArea } from "./commands/scan";

// Phase 1: 无状态基础设施
const dp = new DynamicPropertyStore();
const shards = new ShardStore(dp);
const item = new McItemAdapter();
const factory = new McContainerFactory(item);
const intervals = new McIntervalScheduler();

// Phase 2: 有状态业务逻辑
const bus = new EventBus();
const router = new Router(
  [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
  new DefaultCandidateSorter(),
  bus
);
const warehouseStore = new McWarehouseStore(shards);
const indexStore = new McIndexStore(shards);
const members = new MemberService();
// ⚠️ 早执行安全：create 只建默认值不读 DP（world.getDynamicProperty 早执行会报错）；
// 持久化值在 Phase 4 system.run 里 config.refresh() 读取并重应用
const config = McModConfig.create(shards);
const statsStore = new McStatsStore(shards); // 每容器一条统计键，StatsService 写穿/清除
// 建仓限制：来自模组配置（v1 口径：体积 32×32×16、每玩家 1 仓）
const warehouses = new WarehouseService(
  warehouseStore,
  bus,
  {
    maxEdgeLength: 64,
    minSpacing: 4,
    maxVolume: config.maxWarehouseVolume,
    maxWarehousesPerPlayer: config.maxWarehousesPerPlayer,
  }
  // resize 使仓库 ID 迁移的持久化迁移（cids 索引/调度器重注册）由 Subscriptions 订阅
  // warehouseAreaChanged 处理（事件驱动，统一风格，不再用构造回调 onRebase）
);
const loaded: Warehouse[] = []; // Phase 4 填充
const proximity = new McProximityChecker((id) => loaded.find((w) => w.id === id));
const organizer = new Organizer();
// 每仓库索引生命周期（隔离）：激活时按**每容器条目**恢复/重建，卸载时逐容器落盘（事件驱动）
const indexLifecycle: IndexLifecycle = {
  load: (warehouse) => {
    const idx = new ItemIndex();
    // 读每容器索引条目，齐全则 restoreFromEntries（含角色反演），否则回退全扫重建
    const entries = new Map<ContainerId, { items: string[]; singleBinding?: string }>();
    let complete = true;
    for (const c of warehouse.containers.values()) {
      const entry = indexStore.loadContainer(c.id);
      if (entry === undefined) {
        complete = false;
        break;
      }
      entries.set(c.id, entry);
    }
    if (complete && idx.restoreFromEntries(entries, warehouse.containers.values())) {
      console.warn(`[ItemRoute] 索引加载 ${warehouse.id}`);
    } else {
      for (const c of warehouse.containers.values()) idx.onContainerAdded(c);
      console.warn(`[ItemRoute] 索引重建 ${warehouse.id}`);
    }
    return idx;
  },
  unload: (warehouse, idx) => {
    // 事件驱动落盘（卸载/离仓）：写该仓全部容器的每容器条目；路由增量只内存、重载后惰性自愈
    for (const c of warehouse.containers.values()) {
      indexStore.saveContainer(c.id, idx.serializeContainer(c.id));
    }
  },
};
const scheduler = new Scheduler(
  router,
  intervals,
  proximity,
  bus,
  config.globalSpeedLimit,
  undefined,
  {
    // 每仓库索引隔离：激活加载/空闲卸载
    indexLifecycle,
  }
);
const stats = new StatsService(statsStore, bus);
const route = new RouteService(scheduler);
route.setGlobalEnabled(config.globalEnabled);
// 整理服务：只发事件，不重建索引（候选过期由策略侧惰性校验自愈）
const organize = new OrganizeService(organizer, bus);

// 领域事件订阅（路由副作用/容器持久化/仓库生命周期）统一收编在 events/Subscriptions.ts，
// 由下方 registerSubscriptions 一次性注册。

// ── 容器持久化：每容器一条键（注册表 `ir2:c:{cid}` + 索引 `ir2:idx:{cid}`），事件驱动、最小单位 ──
const entryOf = (c: Container) => ({
  id: c.id,
  role: c.role,
  locations: c.occupiedLocations,
  enabled: c.enabled,
  priority: c.priority,
});
/**
 * 单容器写穿：只写该容器自己的键（注册表 + 有活索引则索引条目）。oldId=重定 ID（双箱合并/半拆）
 * 时清旧注册表键 + 旧索引键（防孤儿）。整仓不重写——改动写入放大从"全仓"降为"单容器"。
 */
const persistContainer = (warehouse: Warehouse, container: Container, oldId?: ContainerId): void => {
  if (oldId !== undefined && oldId !== container.id) {
    warehouseStore.removeContainer(oldId);
    indexStore.removeContainer(oldId);
  }
  warehouseStore.saveContainer(container.id, entryOf(container));
  const idx = scheduler.getIndex(warehouse.id);
  if (idx !== undefined) indexStore.saveContainer(container.id, idx.serializeContainer(container.id));
};
/** 移除容器：清注册表键 + 索引条目键 + 统计键（每容器一条，各自幂等） */
const removeContainer = (warehouse: Warehouse, containerId: ContainerId): void => {
  warehouseStore.removeContainer(containerId);
  indexStore.removeContainer(containerId);
  stats.discard(containerId);
};
/** 同步该仓容器 ID 索引（容器新增/移除/重定 ID 后调用；枚举/清理/删除用） */
const persistContainerIds = (warehouse: Warehouse): void => {
  warehouseStore.saveContainerIds(warehouse.id, [...warehouse.containers.keys()]);
};
// 扫描补注册：只持久化本次新增的容器（最小单位）+ 一次索引同步
const persistScannedContainers = (warehouse: Warehouse, added: Container[]): void => {
  for (const c of added) persistContainer(warehouse, c);
  persistContainerIds(warehouse);
};

// 领域事件订阅中央注册：路由副作用/容器持久化/仓库生命周期 统一在此一处（见 events/Subscriptions.ts）
registerSubscriptions({
  bus,
  loaded,
  stats,
  organizer,
  organize,
  scheduler,
  warehouseStore,
  indexStore,
  factory,
  persistContainer,
  removeContainer,
  persistContainerIds,
  persistScannedContainers,
});

// Phase 3: 注册事件（桥只管内存联动，持久化已由领域事件订阅者负责）
const bridge = new McEventBridge({
  bus,
  resolveIndex: (id) => scheduler.getIndex(id),
  stats,
  scheduler,
  factory,
  warehouses: () => loaded,
});
bridge.start();

// 交互层：选区会话 + 命令 deps + 视觉订阅 + 信物交互
const sessionStore = new SelectionSessionStore();
// 玩家离开：清该玩家选区会话（防下线残留，重连误完成选区）
world.afterEvents.playerLeave.subscribe((e) => {
  sessionStore.clear(e.playerId);
});
const commandDeps: CommandDeps = {
  bus,
  members,
  warehouses,
  stats,
  route,
  organize,
  resolveIndex: (id) => scheduler.getIndex(id),
  config,
  session: sessionStore,
  loadedWarehouses: () => loaded,
  factory,
  persistContainer,
  removeContainer,
  persistContainerIds,
};
registerToolInteraction(commandDeps);
registerSortEffects(bus, {
  dimensionOf: (whId) => {
    const w = loaded.find((x) => x.id === whId);
    return w === undefined ? undefined : world.getDimension(w.area.dimension);
  },
  containerCenter: (containerId) => {
    for (const w of loaded) {
      const c = w.containers.get(containerId);
      if (c && c.occupiedLocations.length > 0) {
        const l = c.occupiedLocations[0]!;
        return { x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 };
      }
    }
    return undefined;
  },
});
registerBoundaryDisplay(bus, (whId) => {
  const w = loaded.find((x) => x.id === whId);
  return w === undefined ? undefined : { dimensionId: w.area.dimension, area: w.area };
});
registerWarningRelay(bus, () => loaded);
registerNotifyRelay(bus, () => loaded);

// Phase 3 续：startup 事件注册 9 命令
system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event.customCommandRegistry, commandDeps);
});

// Phase 4: 延迟启动（世界完全加载）
system.run(() => {
  // 早执行安全：此处置顶读取持久化配置并应用到运行时（Phase 2 用 create 默认值）
  config.refresh();
  route.setGlobalEnabled(config.globalEnabled);
  route.setGlobalSpeedLimit(config.globalSpeedLimit);
  for (const snapshot of warehouseStore.list()) {
    // 重建仓库（core 快照不含容器适配器）
    const warehouse: Warehouse = {
      id: snapshot.id,
      displayName: snapshot.displayName,
      ownerId: snapshot.ownerId,
      members: snapshot.members,
      area: snapshot.area,
      settings: snapshot.settings,
      containers: new Map<string, Container>(),
      inputs: new Map<string, Container>(),
    };
    loaded.push(warehouse);

    // 容器重建：区块加载的按注册表恢复，未加载的由事件/惰性校验补注册
    for (const entry of warehouseStore.loadAllContainers(snapshot.id)) {
      try {
        const block = world.getDimension(snapshot.area.dimension).getBlock(entry.locations[0] ?? { x: 0, y: 0, z: 0 });
        if (block === undefined || block.isAir) continue;
        const container = factory.create(block, entry.role);
        if (container === undefined) continue;
        // 以持久化几何为准（双箱合并状态可能已变化）
        container.occupiedLocations.splice(0, container.occupiedLocations.length, ...entry.locations);
        container.enabled = entry.enabled;
        container.priority = entry.priority;
        registerContainer(warehouse, container);
      } catch {
        // 区块未加载等：跳过，事件补注册
      }
    }

    // 索引不在此预加载：每仓库索引改为"激活时加载/空闲卸载"（数据隔离），
    // 由 Scheduler 经 indexLifecycle 在玩家邻近激活时从 McIndexStore 恢复/重建。
    scheduler.registerWarehouse(warehouse);
    warehouses.loadAll(); // 触发 core 侧缓存（如有）
  }
  console.warn(`[ItemRoute] 启动完成：${loaded.length} 仓库`);
});