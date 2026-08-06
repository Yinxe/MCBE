// ─── item-route 入口：4 Phase 启动装配（DI 组合根） ──
// 本文件是**唯一**的组合根，也是 esbuild bundle 入口（just.config 指向 scripts/main.ts）。
// 只做三件事：构造基础设施 → 调各装配模块 → 延迟启动。业务逻辑（持久边界守卫/控制、
// 背包整理、效果定位器、中央订阅）全部在 `mc/bootstrap|events|persistence` 模块里，
// 这里不含具体业务，只按依赖顺序手工装配：
//   Phase 1 无状态基础设施 —— DP 后端 → ShardStore → McItemAdapter → McContainerFactory
//            → McIntervalScheduler
//   Phase 2 有状态业务 —— EventBus → Router（策略+sorter）→ 三仓储
//            → WarehouseService（注入建仓限制）→ Stats → Scheduler（注入 indexLifecycle）
//            → OrganizeService → 装配：持久边界控制 / 背包整理 / 效果注册
//   Phase 3 注册副作用 —— central Subscriptions（领域事件→持久化/路由副作用/仓库生命周期）
//            + McEventBridge（世界事件）+ 信物交互 + startup 注册命令
//   Phase 4 延迟启动 —— world 加载后：恢复仓库**meta**（容器**不预载**，避免启动载 1 万容器），
//            注册调度；容器/索引/统计统一在仓库激活时按需加载、闲置卸载
// 依赖注入贯穿始终：各模块以构造函数/回调收依赖，不自行 new 外部服务（可测性）。
import { world, system } from "@minecraft/server";

// ── core ──
import { EventBus } from "./core/events/DomainEvents";
import { Router } from "./core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "./core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "./core/routing/CandidateSorter";
import { Scheduler } from "./core/scheduling/Scheduler";
import { StatsService } from "./core/stats/StatsService";
import { Organizer } from "./core/organizing/Organizer";
import { OrganizeService } from "./core/services/OrganizeService";
import { WarehouseService } from "./core/services/WarehouseService";
import { MemberService } from "./core/services/MemberService";
import { RouteService } from "./core/services/RouteService";
import type { Warehouse } from "./core/model/Warehouse";
import type { Container } from "./core/model/Container";

// ── mc：存储/适配/交互/命令 ──
import { DynamicPropertyStore } from "./mc/storage/DynamicPropertyStore";
import { ShardStore } from "./mc/storage/ShardStore";
import { DirectStore } from "./mc/storage/DirectStore";
import { McWarehouseStore } from "./mc/storage/McWarehouseStore";
import { McIndexStore } from "./mc/storage/McIndexStore";
import { McStatsStore } from "./mc/storage/McStatsStore";
import { McModConfig } from "./mc/storage/McModConfig";
import { McItemAdapter } from "./mc/adapters/McItemAdapter";
import { McContainerFactory } from "./mc/adapters/McContainerFactory";
import { McProximityChecker } from "./mc/adapters/McProximityChecker";
import { McIntervalScheduler } from "./mc/adapters/McIntervalScheduler";
import { McEventBridge } from "./mc/adapters/McEventBridge";
import { SelectionSessionStore } from "./mc/interaction/SelectionSessionStore";
import { registerToolInteraction } from "./mc/interaction/ToolInteractionController";
import { registerAllCommands, type CommandDeps } from "./mc/commands/index";

// ── mc：装配模块（业务逻辑抽离处，本文件只调） ──
import { setupPersistentBoundaryControl } from "./mc/bootstrap/persistentBoundary";
import { createInventoryOrganizer } from "./mc/bootstrap/organizeInventory";
import { registerRenderEffects } from "./mc/bootstrap/registerEffects";
import { registerSubscriptions } from "./mc/events/Subscriptions";
import { createContainerPersistence, createIndexLifecycle } from "./mc/persistence/Persistence";
import { ensureContainersLoaded } from "./mc/container/WarehouseLoader";

// Phase 1: 无状态基础设施
const dp = new DynamicPropertyStore();
const shards = new ShardStore(dp); // 仍供 McModConfig（全局配置）+ 旧版整仓键迁移
// 容器级数据（注册表/索引/统计）为单容器小值 → **普通 DP 直存**（无分片/hash/世代开销，更快）
const direct = new DirectStore(dp);
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
// legacyShards 仅供旧版整仓容器键（ShardStore 分包格式）一次性迁移读取
const warehouseStore = new McWarehouseStore(direct, shards);
const indexStore = new McIndexStore(direct);
const members = new MemberService();
// ⚠️ 早执行安全：create 只建默认值不读 DP（world.getDynamicProperty 早执行会报错）；
// 持久化值在 Phase 4 system.run 里 config.refresh() 读取并重应用
const config = McModConfig.create(shards);
const statsStore = new McStatsStore(direct); // 每容器一条统计键（普通 DP 直存），StatsService 写穿/清除
// 建仓限制：来自模组配置（v1 口径：体积 32×32×16、每玩家 1 仓）；Phase 4 refresh 后 setLimits 覆盖
const warehouses = new WarehouseService(
  warehouseStore,
  bus,
  {
    maxSpec: config.maxWarehouseSpec, // 各轴最大边长规格（v1 口径，默认 32×16×32）
    minSpacing: 4,
    maxWarehousesPerPlayer: config.maxWarehousesPerPlayer,
  }
  // resize 使仓库 ID 迁移的持久化迁移（cids 索引/调度器重注册）由 Subscriptions 订阅
  // warehouseAreaChanged 处理（事件驱动，统一风格，不再用构造回调 onRebase）
);
const loaded: Warehouse[] = []; // Phase 4 填充
const proximity = new McProximityChecker((id) => loaded.find((w) => w.id === id));
const organizer = new Organizer();
const stats = new StatsService(statsStore, bus);
// 容器按需加载依赖（配置注册表/统计/索引随仓库生命周期统一，见 container/WarehouseLoader）
const containerLoader = { warehouseStore, factory, stats };
// 索引生命周期（激活 ensureContainersLoaded + 恢复/重建，卸载逐容器落盘 + unloadContainers）收进 persistence/Persistence
const indexLifecycle = createIndexLifecycle(containerLoader, indexStore);
const scheduler = new Scheduler(router, intervals, proximity, bus, config.globalSpeedLimit, undefined, {
  indexLifecycle,
});
const route = new RouteService(scheduler);
route.setGlobalEnabled(config.globalEnabled);
// 整理服务：只发事件，不重建索引（候选过期由策略侧惰性校验自愈）
const organize = new OrganizeService(organizer, bus);

// ── 装配模块（业务抽离）：持久边界控制 / 背包整理 / 效果注册 ──
// 持久边界光幕控制（showBoundary 设置启停；菜单/命令经 deps.boundary 调用）+ 生命周期订阅
const boundary = setupPersistentBoundaryControl({ bus, config, loaded });
// 背包整理（潜行点非容器）：主栏包装成 core Container 就地整理，结果与容器整理同格式
const organizeInventory = createInventoryOrganizer(organize, item);
// 视觉/播报效果：路由闪光（角色颜色粒子）+ 临时边界 + 容量预警 + 成员通知
registerRenderEffects(bus, loaded);

// ── 容器逐容器持久化（注册表/索引/统计每容器一条键，事件驱动最小单位）收进 persistence/Persistence ──
const persistence = createContainerPersistence({ warehouseStore, indexStore, scheduler, stats });

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
  getMaxContainers: () => config.maxContainers, // 实时读（Phase 4 refresh 后自动生效）
  ...persistence,
});

// Phase 3: 注册事件（桥只管内存联动，持久化已由领域事件订阅者负责）
const bridge = new McEventBridge({
  bus,
  resolveIndex: (id) => scheduler.getIndex(id),
  stats,
  scheduler,
  factory,
  warehouses: () => loaded,
  ensureContainersLoaded: (wh) => ensureContainersLoaded(wh, containerLoader),
  getMaxContainers: () => config.maxContainers,
});
bridge.start();

// 交互层：选区会话 + 命令 deps + 信物交互
const sessionStore = new SelectionSessionStore();
// 玩家离开：清该玩家选区会话（防下线残留，重连误完成选区）
world.afterEvents.playerLeave.subscribe((e) => {
  sessionStore.clear(e.playerName);
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
  persistContainer: persistence.persistContainer,
  removeContainer: persistence.removeContainer,
  persistContainerIds: persistence.persistContainerIds,
  ensureContainersLoaded: (wh) => ensureContainersLoaded(wh, containerLoader),
  boundary,
  organizeInventory,
};
registerToolInteraction(commandDeps);

// Phase 3 续：startup 事件注册命令
system.beforeEvents.startup.subscribe((event) => {
  registerAllCommands(event.customCommandRegistry, commandDeps);
});

// Phase 4: 延迟启动（世界完全加载）
system.run(() => {
  // 早执行安全：此处置顶读取持久化配置并应用到运行时（Phase 2 用 create 默认值）
  config.refresh();
  route.setGlobalEnabled(config.globalEnabled);
  route.setGlobalSpeedLimit(config.globalSpeedLimit);
  // 建仓限制用持久化值覆盖 Phase 2 构造时的默认值（否则启动后建仓仍按默认限制校验）
  warehouses.setLimits({
    maxSpec: config.maxWarehouseSpec,
    maxWarehousesPerPlayer: config.maxWarehousesPerPlayer,
  });
  for (const snapshot of warehouseStore.list()) {
    // 重建仓库（core 快照不含容器适配器）
    const warehouse: Warehouse = {
      id: snapshot.id,
      displayName: snapshot.displayName,
      ownerName: snapshot.ownerName,
      members: snapshot.members,
      area: snapshot.area,
      settings: snapshot.settings,
      containers: new Map<string, Container>(),
      inputs: new Map<string, Container>(),
    };
    loaded.push(warehouse);

    // 容器**不在此预载**（按需加载/卸载随仓库生命周期统一）：启动只载仓库 meta + 空容器表，
    // 容器在首次激活（ensure, 见 indexLifecycle.load）或菜单/命令访问（ensureContainersLoaded）时才加载。
    scheduler.registerWarehouse(warehouse);
    warehouses.loadAll(); // 触发 core 侧缓存（如有）

    // 持久边界光幕（showBoundary 设置）：启动时恢复（守卫=附近玩家持信物）
    if (warehouse.settings.showBoundary) boundary.setEnabled(warehouse, true);
  }
  console.warn(`[ItemRoute] 启动完成：${loaded.length} 仓库`);
});
