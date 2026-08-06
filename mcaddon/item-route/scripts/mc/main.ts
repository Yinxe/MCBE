// ─── item-route 入口：4 Phase 启动装配（DI 组合根） ──
// 本文件是唯一的"组合根"：把 core 纯引擎 + mc 适配层按依赖方向手工装配，
// 顺序体现依赖关系（审查时先看这里建立全局心智模型）：
//   Phase 1 无状态基础设施 —— DP 后端 → ShardStore → McItemAdapter → McContainerFactory
//            → McIntervalScheduler
//   Phase 2 有状态业务 —— EventBus → ItemIndex → Router（策略+sorter）→ 三仓储
//            → WarehouseService（注入建仓限制）→ Stats → Scheduler（注入 indexLifecycle）
//            → Organizer/OrganizeService → RouteService + 容器按需加载 loader
//   Phase 3 注册副作用 —— central Subscriptions（领域事件→持久化/路由副作用/仓库生命周期）
//            + McEventBridge（世界事件）+ 信物交互 + 视觉订阅 + startup 注册 9 命令
//   Phase 4 延迟启动 —— world 加载后：恢复仓库**meta**（容器**不预载**，避免启动载 1 万容器），
//            注册调度；容器/索引/统计统一在仓库激活时按需加载、闲置卸载
// 依赖注入贯穿始终：各模块以构造函数/回调收依赖，不自行 new 外部服务（可测性）。
import { world, system, type Player } from "@minecraft/server";

// ── core ──
import { EventBus } from "../core/events/DomainEvents";
import { Router } from "../core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../core/routing/CandidateSorter";
import { Scheduler } from "../core/scheduling/Scheduler";
import { StatsService } from "../core/stats/StatsService";
import { Organizer } from "../core/organizing/Organizer";
import { OrganizeService, type OrganizeResult } from "../core/services/OrganizeService";
import { WarehouseService } from "../core/services/WarehouseService";
import { MemberService } from "../core/services/MemberService";
import { RouteService } from "../core/services/RouteService";
import { MoveJournal } from "../core/routing/Move";
import { isPlayerNearby } from "../core/model/Area";
import type { Warehouse } from "../core/model/Warehouse";
import type { Container } from "../core/model/Container";

// ── mc ──
import { DynamicPropertyStore } from "./storage/DynamicPropertyStore";
import { ShardStore } from "./storage/ShardStore";
import { DirectStore } from "./storage/DirectStore";
import { McWarehouseStore } from "./storage/McWarehouseStore";
import { McIndexStore } from "./storage/McIndexStore";
import { McStatsStore } from "./storage/McStatsStore";
import { McModConfig } from "./storage/McModConfig";
import { McItemAdapter } from "./adapters/McItemAdapter";
import { McContainerFactory } from "./adapters/McContainerFactory";
import { McProximityChecker } from "./adapters/McProximityChecker";
import { McIntervalScheduler } from "./adapters/McIntervalScheduler";
import { McEventBridge } from "./adapters/McEventBridge";
import { PlayerInventoryContainer } from "./adapters/PlayerInventoryContainer";
import { SelectionSessionStore } from "./interaction/SelectionSessionStore";
import { registerToolInteraction } from "./interaction/ToolInteractionController";
import { registerAllCommands, type CommandDeps } from "./commands/index";
import { registerSortEffects } from "./effects/SortEffects";
import {
  registerBoundaryDisplay,
  startPersistentBoundary,
  stopBoundary,
  PROXIMITY_MARGIN,
} from "./effects/BoundaryDisplay";
import { registerWarningRelay } from "./effects/WarningRelay";
import { registerNotifyRelay } from "./effects/NotifyRelay";
import { registerSubscriptions } from "./events/Subscriptions";
import { createContainerPersistence, createIndexLifecycle } from "./persistence/Persistence";
import { ensureContainersLoaded } from "./container/WarehouseLoader";
import { scanWarehouseArea } from "./commands/scan";

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

// ── 持久边界守卫：附近玩家持信物才显示（v1 BoundaryDisplay requireHoe 口径） ──
const boundaryGuard =
  (wh: Warehouse): (() => boolean) =>
  () => {
    for (const p of world.getAllPlayers()) {
      if (p.dimension.id !== wh.area.dimension) continue;
      let holdingToken = false;
      try {
        const held = p.getComponent("inventory")?.container?.getItem(p.selectedSlotIndex);
        holdingToken = config.isToken(held?.typeId ?? "");
      } catch {
        /* 读取失败视为未持信物 */
      }
      if (!holdingToken) continue;
      if (
        isPlayerNearby(wh.area, [{ dimension: p.dimension.id, x: p.location.x, z: p.location.z }], PROXIMITY_MARGIN)
      ) {
        return true;
      }
    }
    return false;
  };
// 持久边界光幕控制（showBoundary 设置启停；装配层持有，菜单/命令经 deps.boundary 调用）
const boundaryControl = {
  setEnabled: (wh: Warehouse, enabled: boolean): void => {
    if (enabled) startPersistentBoundary(wh.id, { dimensionId: wh.area.dimension, area: wh.area }, boundaryGuard(wh));
    else stopBoundary(wh.id);
  },
};
// 持久边界生命周期：删仓停；resize 迁移后按新区域重启（showBoundary 开启时）
bus.warehouseDeleted.subscribe((e) => stopBoundary(e.warehouseId));
bus.warehouseAreaChanged.subscribe((e) => {
  if (e.oldId !== undefined) stopBoundary(e.oldId);
  const wh = loaded.find((w) => w.id === e.warehouseId);
  if (wh !== undefined && wh.settings.showBoundary) boundaryControl.setEnabled(wh, true);
});

// ── 背包整理（潜行点非容器）：把背包主栏包装成 core Container 就地整理，结果与容器整理同格式 ──
const organizeInventory = (player: Player): OrganizeResult => {
  const inv = player.getComponent("inventory")?.container;
  if (inv === undefined) {
    return {
      ok: false,
      moves: 0,
      beforeStacks: 0,
      afterStacks: 0,
      beforeTypes: 0,
      afterTypes: 0,
      totalSlots: 0,
      usedSlots: 0,
      messiness: {
        total: 0,
        order: 0,
        stack: 0,
        effectiveSlots: 0,
        disorderSlots: 0,
        nonEmptySlots: 0,
        suboptimalStacks: 0,
      },
      chaosAfter: 0,
      perType: {},
    };
  }
  const adapter = new PlayerInventoryContainer(`player:${player.name}`, inv, item);
  return organize.organizeStandalone(adapter, new MoveJournal());
};

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
});
bridge.start();

// 交互层：选区会话 + 命令 deps + 视觉订阅 + 信物交互
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
  boundary: boundaryControl,
  organizeInventory,
};
registerToolInteraction(commandDeps);
registerSortEffects(bus, {
  dimensionOf: (whId) => {
    const w = loaded.find((x) => x.id === whId);
    return w === undefined ? undefined : world.getDimension(w.area.dimension);
  },
  // 定位命中容器 → 坐标 + 角色（颜色）+ 方块类型（粒子尺寸），供角色颜色粒子/音效对齐 v1
  targetOf: (containerId) => {
    for (const w of loaded) {
      const c = w.containers.get(containerId);
      if (c !== undefined && c.occupiedLocations.length > 0) {
        return {
          occupiedLocations: c.occupiedLocations,
          role: c.role,
          blockType: (c as { blockType?: string }).blockType ?? "",
        };
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
  // 建仓限制用持久化值覆盖 Phase 2 构造时的默认值（否则启动后建仓仍按默认限制校验）
  warehouses.setLimits({
    maxVolume: config.maxWarehouseVolume,
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
    if (warehouse.settings.showBoundary) boundaryControl.setEnabled(warehouse, true);
  }
  console.warn(`[ItemRoute] 启动完成：${loaded.length} 仓库`);
});
