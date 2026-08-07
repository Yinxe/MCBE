// ─── 仓库容器按需加载/卸载：配置注册表/统计/索引随仓库生命周期统一 ──
// 启动不预载容器（100 仓 × 100 容器 = 1 万条启动即载是可避免的开销，且违背按需加载）。
// 容器在**首次真正用到时**才 `ensureContainersLoaded`，随仓库激活/卸载/离仓统一生命周期：
//   · load 侧（仓库激活、菜单/命令访问）→ ensureContainersLoaded（幂等）
//   · unload 侧（仓库空闲卸载/删仓）→ unloadContainers（清内存 + 丢弃统计缓存）
// 容器级所有数据（配置注册表 / 统计缓存 / 索引）生命周期一致，都挂这个 load/unload。
import { world } from "@minecraft/server";
import type { McWarehouseStore } from "../storage/McWarehouseStore";
import type { McContainerFactory } from "../adapters/McContainerFactory";
import type { StatsService } from "../../core/stats/StatsService";
import type { Warehouse } from "../../core/model/Warehouse";
import { registerContainer } from "../../core/model/ContainerRegistry";

export interface WarehouseLoaderDeps {
  warehouseStore: McWarehouseStore;
  factory: McContainerFactory;
  stats: StatsService;
}

/**
 * 按需加载该仓容器（注册表 → 工厂创建适配器 → registerContainer 填充 containers/inputs）。
 * **合并语义**（非"size>0 即跳过"）：以注册表为准，补齐所有不在内存的容器——即使此前有
 * 单个容器经 place 事件先注册（部分加载），激活/菜单 ensure 仍会把其余容器补全。幂等。
 * 区块未加载的容器跳过，由事件/策略侧 reconcile 惰性补注册。
 */
export function ensureContainersLoaded(warehouse: Warehouse, deps: WarehouseLoaderDeps): void {
  const loadedIds = new Set(warehouse.containers.keys());
  for (const entry of deps.warehouseStore.loadAllContainers(warehouse.id)) {
    if (loadedIds.has(entry.id)) continue; // 已在内存（激活/place 已注册）→ 跳过
    try {
      const block = world.getDimension(warehouse.area.dimension).getBlock(entry.locations[0] ?? { x: 0, y: 0, z: 0 });
      if (block === undefined || block.isAir) continue;
      const container = deps.factory.create(block, entry.role);
      if (container === undefined) continue;
      container.enabled = entry.enabled;
      container.priority = entry.priority;
      container.warningEnabled = entry.warningEnabled ?? true; // 旧档缺字段 → 默认开
      container.familyEnabled = entry.familyEnabled ?? false; // 旧档缺字段 → 默认关
      container.whitelist = entry.whitelist ?? [];
      container.blacklist = entry.blacklist ?? [];
      registerContainer(warehouse, container);
    } catch {
      // 区块未加载等：跳过
    }
  }
}

/**
 * 卸载该仓容器（闲置/删仓安全释放）：清 containers/inputs + 丢弃成员统计缓存（冷读重算）。
 * 必须在索引已落盘之后再调用（索引逐容器条目依赖 containers 在场）。
 */
export function unloadContainers(warehouse: Warehouse, deps: WarehouseLoaderDeps): void {
  for (const c of warehouse.containers.keys()) deps.stats.invalidate(c);
  warehouse.containers.clear();
  warehouse.inputs.clear();
}
