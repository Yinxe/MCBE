// ─── item-route 入口：4 Phase 启动装配（DI） ──
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

// Phase 1: 无状态基础设施
const dp = new DynamicPropertyStore();
const shards = new ShardStore(dp, () => dp.totalBytes());
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
const warehouses = new WarehouseService(warehouseStore, bus);
const members = new MemberService();
const config = McModConfig.load(shards);
const loaded: Warehouse[] = []; // Phase 4 填充
const proximity = new McProximityChecker((id) => loaded.find((w) => w.id === id));
const scheduler = new Scheduler(router, intervals, proximity, bus, config.globalSpeedLimit);
const stats = new StatsService(new McStatsStore(shards), bus);
const organizer = new Organizer(new DefaultCandidateSorter());
const organize = new OrganizeService(organizer, index, bus);
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