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
import { scanContainer } from "../core/model/ContainerScan";
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
import { registerContainer } from "../core/model/ContainerRegistry";

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
import { registerNotifyRelay } from "./effects/NotifyRelay";
import { MoveJournal } from "../core/routing/Move";

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
const config = McModConfig.load(shards);
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
  },
  // resize 改变区域 → 仓库 ID 重算 → 迁移所有按 id 存储的键 + 调度器重注册
  (wh, oldId, newId) => {
    const idx = indexStore.load(oldId);
    if (idx !== undefined) indexStore.save(newId, idx);
    indexStore.remove(oldId);
    // 统计键是**每容器一条**（`ir2:cst:{containerId}`），仓库 resize 不改变容器 ID → 无需迁移
    const entries = warehouseStore.loadContainers(oldId);
    if (entries !== undefined) warehouseStore.saveContainers(newId, entries);
    scheduler.unregisterWarehouse(oldId);
    scheduler.registerWarehouse(wh);
  }
);
const loaded: Warehouse[] = []; // Phase 4 填充
const proximity = new McProximityChecker((id) => loaded.find((w) => w.id === id));
const organizer = new Organizer();
// 每仓库索引生命周期（隔离）：激活时从 McIndexStore 加载/恢复，空闲卸载时落盘
const indexLifecycle: IndexLifecycle = {
  load: (warehouse) => {
    const idx = new ItemIndex();
    const snap = indexStore.load(warehouse.id);
    if (snap !== undefined && idx.restore(snap)) {
      console.warn(`[ItemRoute] 索引加载 ${warehouse.id}`);
      return idx;
    }
    for (const c of warehouse.containers.values()) idx.onContainerAdded(c);
    console.warn(`[ItemRoute] 索引重建 ${warehouse.id}`);
    return idx;
  },
  unload: (warehouse, idx) => {
    // 落盘最新快照（实际写入由 100-tick / playerLeave flush 批量完成）
    indexStore.markDirty(warehouse.id, idx);
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

// 路由成功副作用：itemRouted 多个订阅者依次处理（EventSignal 隔离各订阅者异常）
// ① 容器/容量统计增量失效（源 + 目标）
bus.itemRouted.subscribe((e) => {
  stats.invalidate(e.from);
  stats.invalidate(e.to);
});
// ② 混乱度检查 → 阈值自动整理（**单容器整理**目标容器，v1 onDeposit 语义）；
//    同一次 scanContainer 扫描趁机维护目标容器统计（免二次扫描）
bus.itemRouted.subscribe((e) => {
  const wh = loaded.find((x) => x.id === e.warehouseId);
  if (wh === undefined || !wh.settings.sortingEnabled) return;
  const target = wh.containers.get(e.to);
  if (target === undefined) return;
  const scan = scanContainer(target);
  if (organizer.shouldAutoSortFromScan(scan, wh.settings.autoSortThreshold)) {
    organize.organizeContainer(wh, target, new MoveJournal()); // 就地整理该容器
    stats.invalidate(e.to); // 整理改变了目标内容
  } else {
    stats.updateFromScan(target, scan, wh.settings.warningThreshold); // 趁机增量维护统计
  }
});
// ③ 容量增量：路由后目标容器容量变化 → 容器级预警（只查目标，O(1) 无全仓扫描；冷却抑制重复）
bus.itemRouted.subscribe((e) => {
  const wh = loaded.find((x) => x.id === e.warehouseId);
  if (wh !== undefined) stats.evaluateWarnings(wh, e.to);
});
// ④ 路由成功视觉反馈：目标容器闪光（v1 同款：放入物品即播放粒子）
bus.itemRouted.subscribe((e) => {
  bus.visualEffect.trigger({ type: "visual-effect", kind: "route-flash", warehouseId: e.warehouseId, containerId: e.to });
});
// ⑤ 仓库删除：清内存（loaded 剔除 + 停调度 + 卸载索引）+ 清持久化键，杜绝删后仍分拣/残影
bus.warehouseDeleted.subscribe((e) => {
  const wh = loaded.find((w) => w.id === e.warehouseId);
  const i = loaded.findIndex((w) => w.id === e.warehouseId);
  if (i >= 0) loaded.splice(i, 1);
  scheduler.unregisterWarehouse(e.warehouseId); // 停 interval + indexLifecycle.unload（unload 会把活索引 markDirty）
  indexStore.remove(e.warehouseId);             // 清 dirty + 持久索引键（不复活）
  if (wh !== undefined) {
    for (const c of wh.containers.keys()) stats.discard(c); // 清该仓各容器统计键（每容器一条）
  }
});

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
  resolveIndex: (id) => scheduler.getIndex(id),
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
registerNotifyRelay(bus, () => loaded);

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
      inputs: new Map<string, Container>(),
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