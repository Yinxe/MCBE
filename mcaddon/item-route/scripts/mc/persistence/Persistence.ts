// ─── 持久化装配：容器逐容器持久化（每容器一条键，事件驱动） + 索引纯运行时生命周期 ──
// 把 main.ts 组合根里的两段持久化逻辑收进独立模块，组合根只保留一行装配：
//   · createIndexRuntimeLifecycle —— 索引**纯运行时**生命周期：激活时按真实内容全量扫描
//     重建（onContainerAdded），卸载即弃（不落盘）。索引是派生缓存，权威源 = 容器内容，
//     重启无需持久化——永远最新、零写放大。
//   · createContainerPersistence —— 单容器写穿（注册表 ir2:c；统计 ir2:cst 由 stats 自行）
//     索引不落盘，故容器结构落地不再同步写索引条目。
import { ItemIndex } from "../../core/index/ItemIndex";
import type { IndexLifecycle } from "../../core/scheduling/Scheduler";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { StatsService } from "../../core/stats/StatsService";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import type { ContainerId } from "../../core/model/types";
import type { McWarehouseStore } from "../storage/McWarehouseStore";
import { ensureContainersLoaded, unloadContainers, type WarehouseLoaderDeps } from "../container/WarehouseLoader";

// ── 索引生命周期（纯运行时） ─────────────────────────────
/**
 * 索引生命周期（Scheduler 激活/卸载时调用）。**索引不持久化**：
 *   · load —— ensureContainersLoaded（按需加载容器）→ 全容器扫描按真实内容重建（O(容器×槽)），
 *     权威源 = 容器内容，永远最新，无落盘依赖。
 *   · unload —— 直接 unloadContainers 清内存（容器/索引/统计缓存一并释放）。
 * loader 需 warehouseStore/factory/stats（见 container/WarehouseLoader）。
 */
export function createIndexRuntimeLifecycle(loader: WarehouseLoaderDeps): IndexLifecycle {
  return {
    load: (warehouse) => {
      ensureContainersLoaded(warehouse, loader); // 激活按需加载容器（此时 containers 才齐，供索引用）
      const idx = new ItemIndex();
      // 全量重建：权威源 = 容器真实内容，不读任何索引持久化（纯运行时派生缓存）
      for (const c of warehouse.containers.values()) idx.onContainerAdded(c);
      return idx;
    },
    unload: (warehouse) => {
      // 索引不落盘（纯运行时缓存）——只卸载容器实体与内存
      unloadContainers(warehouse, loader);
    },
  };
}

// ── 容器逐容器持久化（注册表 + 让 stats 管统计；索引不落盘） ──
export interface ContainerPersistenceDeps {
  warehouseStore: McWarehouseStore;
  scheduler: Scheduler;
  stats: StatsService;
}

export interface ContainerPersistence {
  /** 单容器写穿（注册表；索引为纯内存缓存不落盘）；oldId=重定 ID 时清旧注册表/统计 */
  persistContainer: (warehouse: Warehouse, container: Container, oldId?: ContainerId) => void;
  /** 移除容器：清注册表键 + 统计键（每容器一条，各自幂等） */
  removeContainer: (warehouse: Warehouse, containerId: ContainerId) => void;
  /** 同步该仓容器 ID 索引（容器新增/移除/重定 ID 后调用；枚举/清理/删除用） */
  persistContainerIds: (warehouse: Warehouse) => void;
  /** 扫描补注册：只持久化本次新增的容器 + 一次索引同步 */
  persistScannedContainers: (warehouse: Warehouse, added: Container[]) => void;
}

export function createContainerPersistence(deps: ContainerPersistenceDeps): ContainerPersistence {
  const { warehouseStore, stats } = deps;
  const entryOf = (c: Container) => ({
    id: c.id,
    warehouseId: c.warehouseId, // 直接归属解析（findContainerAt 不再逐仓扫）
    role: c.role,
    locations: c.occupiedLocations,
    enabled: c.enabled,
    priority: c.priority,
    warningEnabled: c.warningEnabled,
    familyEnabled: c.familyEnabled,
    whitelist: c.whitelist,
    blacklist: c.blacklist,
  });

  const persistContainer = (warehouse: Warehouse, container: Container, oldId?: ContainerId): void => {
    if (oldId !== undefined && oldId !== container.id) {
      warehouseStore.removeContainer(oldId);
    }
    warehouseStore.saveContainer(container.id, entryOf(container));
    void warehouse;
  };

  const removeContainer = (warehouse: Warehouse, containerId: ContainerId): void => {
    warehouseStore.removeContainer(containerId);
    stats.discard(containerId);
    void warehouse;
  };

  const persistContainerIds = (warehouse: Warehouse): void => {
    warehouseStore.saveContainerIds(warehouse.id, [...warehouse.containers.keys()]);
  };

  const persistScannedContainers = (warehouse: Warehouse, added: Container[]): void => {
    for (const c of added) persistContainer(warehouse, c);
    persistContainerIds(warehouse);
  };

  return { persistContainer, removeContainer, persistContainerIds, persistScannedContainers };
}