// ─── 持久化装配：索引生命周期 + 容器逐容器持久化（每容器一条键，事件驱动） ──
// 把 main.ts 组合根里的两段持久化逻辑收进独立模块，组合根只保留一行装配：
//   · createIndexLifecycle —— 索引生命周期（激活按每容器条目恢复/重建，卸载逐容器落盘）
//   · createContainerPersistence —— 单容器写穿（注册表 ir2:c + 索引 ir2:idx + 统计 ir2:cst）
// 两者都坚持"最小粒度 + 事件驱动"：整仓不重写，改动写入放大从"全仓"降为"单容器"。
import { ItemIndex } from "../../core/index/ItemIndex";
import type { IndexLifecycle } from "../../core/scheduling/Scheduler";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { StatsService } from "../../core/stats/StatsService";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import type { ContainerId } from "../../core/model/types";
import type { McWarehouseStore } from "../storage/McWarehouseStore";
import type { McIndexStore } from "../storage/McIndexStore";

// ── 索引生命周期 ─────────────────────────────────────────
/**
 * 索引生命周期（Scheduler 激活/卸载时调用）：激活按**每容器条目**恢复（含角色反演），
 * 缺条目/版本不符回退全扫重建；卸载/离仓**逐容器落盘**（路由增量只内存、重载后惰性自愈）。
 */
export function createIndexLifecycle(indexStore: McIndexStore): IndexLifecycle {
  return {
    load: (warehouse) => {
      const idx = new ItemIndex();
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
      for (const c of warehouse.containers.values()) {
        indexStore.saveContainer(c.id, idx.serializeContainer(c.id));
      }
    },
  };
}

// ── 容器逐容器持久化 ─────────────────────────────────────
export interface ContainerPersistenceDeps {
  warehouseStore: McWarehouseStore;
  indexStore: McIndexStore;
  scheduler: Scheduler;
  stats: StatsService;
}

export interface ContainerPersistence {
  /** 单容器写穿（注册表 + 有活索引则索引条目）；oldId=重定 ID 时清旧注册表/索引键 */
  persistContainer: (warehouse: Warehouse, container: Container, oldId?: ContainerId) => void;
  /** 移除容器：清注册表键 + 索引条目键 + 统计键（每容器一条，各自幂等） */
  removeContainer: (warehouse: Warehouse, containerId: ContainerId) => void;
  /** 同步该仓容器 ID 索引（容器新增/移除/重定 ID 后调用；枚举/清理/删除用） */
  persistContainerIds: (warehouse: Warehouse) => void;
  /** 扫描补注册：只持久化本次新增的容器 + 一次索引同步 */
  persistScannedContainers: (warehouse: Warehouse, added: Container[]) => void;
}

export function createContainerPersistence(deps: ContainerPersistenceDeps): ContainerPersistence {
  const { warehouseStore, indexStore, scheduler, stats } = deps;
  const entryOf = (c: Container) => ({
    id: c.id,
    role: c.role,
    locations: c.occupiedLocations,
    enabled: c.enabled,
    priority: c.priority,
  });

  const persistContainer = (warehouse: Warehouse, container: Container, oldId?: ContainerId): void => {
    if (oldId !== undefined && oldId !== container.id) {
      warehouseStore.removeContainer(oldId);
      indexStore.removeContainer(oldId);
    }
    warehouseStore.saveContainer(container.id, entryOf(container));
    const idx = scheduler.getIndex(warehouse.id);
    if (idx !== undefined) indexStore.saveContainer(container.id, idx.serializeContainer(container.id));
  };

  const removeContainer = (warehouse: Warehouse, containerId: ContainerId): void => {
    warehouseStore.removeContainer(containerId);
    indexStore.removeContainer(containerId);
    stats.discard(containerId);
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
