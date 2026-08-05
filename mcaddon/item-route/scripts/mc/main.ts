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
//            未加载区块的容器留待事件/verifyCandidate 惰性补注册
// 依赖注入贯穿始终：各模块以构造函数/回调收依赖，不自行 new 外部服务（可测性）。
import { world, system } from "@minecraft/server";

// ── core ──
import { EventBus } from "../core/events/DomainEvents";
import { ItemIndex } from "../core/index/ItemIndex";
import { Router } from "../core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../core/routing/CandidateSorter";
import { Scheduler } from "../core/scheduling/Scheduler";
import { StatsService } from "../core/stats/StatsService";
import { Organizer } from "../core/organizing/Organizer";
import { OrganizeService } from "../core/services/OrganizeService";
import { WarehouseService } from "../core/services/WarehouseService";
import { MemberService } from "../core/services/MemberService";
import { RouteService } from "../core/services/RouteService";
import type { Warehouse } from "../core/model/Warehouse";
import type { Container } from "../core/model/Container";

// ── mc ──
import { DynamicPropertyStore } from "./storage/DynamicPropertyStore";
import { ShardStore } from "./storage/ShardStore";
import { McWarehouseStore, type ContainerEntry } from "./storage/McWarehouseStore";
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
import { MoveJournal } from "../core/routing/Move";

// Phase 1: 无状态基础设施
const dp = new DynamicPropertyStore();
const shards = new ShardStore(dp);
const item = new McItemAdapter();
const factory = new McContainerFactory(item);
const intervals = new McIntervalScheduler();

// Phase 2: 有状态业务逻辑
const bus = new EventBus();
const index = new ItemIndex();
const router = new Router(
  [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
  new DefaultCandidateSorter(),
  index,
  bus
);
const warehouseStore = new McWarehouseStore(shards);
const indexStore = new McIndexStore(shards);
const members = new MemberService();
const config = McModConfig.load(shards);
// 建仓限制：来自模组配置（v1 口径：体积 32×32×16、每玩家 1 仓）
const warehouses = new WarehouseService(warehouseStore, bus, {
  maxEdgeLength: 64,
  minSpacing: 4,
  maxVolume: config.maxWarehouseVolume,
  maxWarehousesPerPlayer: config.maxWarehousesPerPlayer,
});
const loaded: Warehouse[] = []; // Phase 4 填充
const proximity = new McProximityChecker((id) => loaded.find((w) => w.id === id));
const organizer = new Organizer(new DefaultCandidateSorter());
const organize = new OrganizeService(organizer, index, bus);
const scheduler = new Scheduler(
  router,
  intervals,
  proximity,
  bus,
  config.globalSpeedLimit,
  undefined,
  // 自动整理（v1 onDeposit）：目标容器混乱度超阈值即整理该仓
  (wh, target) => {
    if (organizer.shouldAutoSort(target, wh.settings.autoSortThreshold)) {
      organize.organize(wh, new MoveJournal());
    }
  }
);
const stats = new StatsService(new McStatsStore(shards), bus);
const route = new RouteService(scheduler);
route.setGlobalEnabled(config.globalEnabled);

// 容器注册表持久化钩子（事件桥接 → DP）
const persistContainers = (warehouse: Warehouse): void => {
  const entries: ContainerEntry[] = [...warehouse.containers.values()].map((c) => ({
    id: c.id,
    role: c.role,
    locations: c.occupiedLocations,
    enabled: c.enabled,
    priority: c.priority,
  }));
  warehouseStore.saveContainers(warehouse.id, entries);
};

// Phase 3: 注册事件
const bridge = new McEventBridge({
  bus,
  index,
  stats,
  scheduler,
  indexStore,
  factory,
  warehouses: () => loaded,
  onContainerRegistered: persistContainers,
  onContainerUnregistered: persistContainers,
});
bridge.start();

// 交互层：选区会话 + 命令 deps + 视觉订阅 + 信物交互
const sessionStore = new SelectionSessionStore();
const commandDeps: CommandDeps = {
  bus,
  members,
  warehouses,
  stats,
  route,
  organize,
  index,
  config,
  session: sessionStore,
  loadedWarehouses: () => loaded,
  factory,
  persistContainers,
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

// Phase 3 续：startup 事件注册 9 命令
system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event.customCommandRegistry, commandDeps);
});

// Phase 4: 延迟启动（世界完全加载）
system.run(() => {
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
    };
    loaded.push(warehouse);

    // 容器重建：区块加载的按注册表恢复，未加载的由事件/惰性校验补注册
    for (const entry of warehouseStore.loadContainers(snapshot.id) ?? []) {
      try {
        const block = world.getDimension(snapshot.area.dimension).getBlock(entry.locations[0] ?? { x: 0, y: 0, z: 0 });
        if (block === undefined || block.isAir) continue;
        const container = factory.create(block, entry.role);
        if (container === undefined) continue;
        // 以持久化几何为准（双箱合并状态可能已变化）
        container.occupiedLocations.splice(0, container.occupiedLocations.length, ...entry.locations);
        container.enabled = entry.enabled;
        container.priority = entry.priority;
        warehouse.containers.set(container.id, container);
      } catch {
        // 区块未加载等：跳过，事件补注册
      }
    }

    // 索引恢复：版本不符/缺失 → 全量重建（verifyCandidate 兜底路径）
    const snap = indexStore.load(snapshot.id);
    if (snap !== undefined && index.restore(snap)) {
      console.warn(`[ItemRoute] 索引恢复 ${snapshot.id}`);
    } else {
      for (const c of warehouse.containers.values()) index.onContainerAdded(c);
      console.warn(`[ItemRoute] 索引重建 ${snapshot.id}`);
    }

    scheduler.registerWarehouse(warehouse);
    warehouses.loadAll(); // 触发 core 侧缓存（如有）
  }
  console.warn(`[ItemRoute] 启动完成：${loaded.length} 仓库`);
});