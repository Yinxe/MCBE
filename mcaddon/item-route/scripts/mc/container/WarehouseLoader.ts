// ─── 仓库容器按需加载/卸载 + 待补容器主循环重载（简单版） ──
// 启动不预载容器（100 仓 × 100 容器 = 1 万条启动即载是可避免的开销，且违背按需加载）。
// 容器在**首次真正用到时**才 `ensureContainersLoaded`，随仓库激活/卸载/离仓统一生命周期：
//   · load 侧（仓库激活、菜单/命令访问）→ ensureContainersLoaded（幂等）
//   · 主循环（仓库活着期间）→ pumpPendingReloads（对**跳过注册的容器**逐个重载，见下）
//   · unload 侧（仓库空闲卸载/删仓）→ unloadContainers（清内存 + 丢弃统计缓存 + 待补集）
//
// 容器补注册（简单版，审查必读）：
//   · ensureContainersLoaded 遍历注册表时，若某容器方块所在区块未加载（getBlock 返回
//     undefined/抛错）→ 该容器**无法本次注册**：触发 `bus.containerDeferred` 事件（容器已登记
//     pendingReloads）。空气/非受支持容器经工厂判空后同样登记待补、由 pump 复判；
//     **ensure 只登记待补、不做删除决策**（不首轮误删）。
//   · pumpPendingReloads：对 pending 里每个 cid 重新读方块（由**仓库激活后的 routing interval**
//     周期触发，见 Scheduler.createInterval refresh）：
//       已加载、非空气且是**受支持容器类型** → 重建适配器注册进仓库 + 索引（onContainerAdded）
//       已加载且空气 / 替换成**非容器方块** → 确认"容器真被拆/被换" → 移除注册表条目 + cids 索引 + 统计键
//       仍读不到         → 保留 pending，下轮再试（不报错不空转删错）
//   · 主循环 tick 不修正容器；补注册随每仓 interval（≈每轮路由，默认 ~1s）进行——激活后
//     第一个 interval 周期即覆盖"激活瞬间区块慢加载"的窗口，无需独立定时器。
// 索引纯运行时：容器配置注册表（ir2:c:{cid}）/ 统计（ir2:cst）持久化在 DP，容器内容权威源 = 游戏。
import { world } from "@minecraft/server";
import type { McWarehouseStore } from "../storage/McWarehouseStore";
import type { McContainerFactory } from "../adapters/McContainerFactory";
import type { StatsService } from "../../core/stats/StatsService";
import type { EventBus } from "../../core/events/DomainEvents";
import type { Container } from "../../core/model/Container";
import type { Warehouse } from "../../core/model/Warehouse";
import type { ContainerEntry } from "../storage/McWarehouseStore";
import { registerContainer } from "../../core/model/ContainerRegistry";
import { pendingReloadsOf } from "../../core/model/Warehouse";
import { decidePendingAction } from "../../core/scheduling/RegistryReconcile";

export interface WarehouseLoaderDeps {
  warehouseStore: McWarehouseStore;
  factory: McContainerFactory;
  stats: StatsService;
  /** 领域事件总线（可选）：ensure 跳过注册时触发 containerDeferred，供主循环 pump 用 */
  bus?: EventBus;
}

/**
 * 按需加载该仓容器（注册表 → 工厂创建适配器 → registerContainer 填充 containers/inputs）。
 * **合并语义**（非"size>0 即跳过"）：以注册表为准，补齐所有不在内存的容器——即使此前有
 * 单个容器经 place 事件先注册（部分加载），激活/菜单 ensure 仍会把其余容器补全。幂等。
 * **跳过注册**：方块区块未加载 / 空气 / 已加载但非受支持容器 → 触发 containerDeferred（登记待补集），
 * 由主循环 pump 重载（区块慢加载的等一会再注册；空气/非容器经 pump 确认后移除注册表）。
 */
export function ensureContainersLoaded(warehouse: Warehouse, deps: WarehouseLoaderDeps): void {
  const loadedIds = new Set(warehouse.containers.keys());
  for (const entry of deps.warehouseStore.loadAllContainers(warehouse.id)) {
    if (loadedIds.has(entry.id)) continue; // 已在内存（激活/place 已注册）→ 跳过
    const block = readBlock(warehouse, entry.locations[0] ?? { x: 0, y: 0, z: 0 });
    if (block === undefined) {
      // **只有 undefined = 区块未加载**（唯一瞬态）→ 无法本次注册，登记待补（幂等），
      // 由激活后的 routing interval pump 重试。空气/非容器不属于瞬态，走下方 createFromEntry
      // 判空后同样登记待补，由 pump 复判确认移除（不在此处决策删除，避免首轮误删）。
      pendingReloadsOf(warehouse).add(entry.id);
      deps.bus?.containerDeferred.trigger({
        type: "container-deferred",
        warehouseId: warehouse.id,
        containerId: entry.id,
      });
      continue;
    }
    const container = createFromEntry(warehouse, deps, entry, block);
    if (container === undefined) {
      // 空气 / 非受支持容器（被换成铁砧/杂物等）→ 也登记待补（非静默丢弃）：
      // pump 复判——空气或非容器方块 → remove 移除注册表；若只是瞬时装配失败则下轮补注册。
      pendingReloadsOf(warehouse).add(entry.id);
      deps.bus?.containerDeferred.trigger({
        type: "container-deferred",
        warehouseId: warehouse.id,
        containerId: entry.id,
      });
      continue;
    }
    registerContainer(warehouse, container);
  }
}

/**
 * 主循环待补容器重载（仓库活着期间周期执行）：对 `warehouse.pendingReloads` 里**跳过注册**的容器
 * 逐个重读方块：
 *   · 已加载且非空气 → 重建适配器注册（registerContainer + index.onContainerAdded），从待补集移除
 *   · 已加载且空气     → 容器真被拆了（区块加载后确认）→ 移除注册表条目 + cids 引用 + 统计键，从待补集移除
 *   · 仍读不到（区块未加载）→ 保留待补，下轮再试
 * 决策见 core/scheduling/RegistryReconcile.decidePendingAction（纯函数，可单测）。
 * 幂等：只处理待补集中、且尚未注册的容器。调用时机：每次仓库激活 load、主循环固定节律。
 */
export function pumpPendingReloads(
  warehouse: Warehouse,
  deps: WarehouseLoaderDeps,
  index: { onContainerAdded(c: Container): void } | undefined
): void {
  const pending = pendingReloadsOf(warehouse);
  if (pending.size === 0) return;
  for (const cid of [...pending]) {
    // 已在内存（并行注册/place 补上）→ 移出待补
    if (warehouse.containers.has(cid)) {
      pending.delete(cid);
      continue;
    }
    const entry = deps.warehouseStore.loadContainer(cid);
    if (entry === undefined) {
      pending.delete(cid); // 注册表条目已清（删仓/幽灵）→ 待补无意义
      continue;
    }
    const block = readBlock(warehouse, entry.locations[0] ?? { x: 0, y: 0, z: 0 });
    const action =
      block === undefined ? decidePendingAction(undefined) : decidePendingAction({ isAir: block.isAir, typeId: block.typeId });
    if (action === "skip") continue; // 区块仍未加载 → 下轮
    pending.delete(cid); // 本轮必有结论（remove / register）
    if (action === "remove") {
      // 确认容器已拆（空气 / 替换成非受支持容器方块）→ 移除注册表 + 统计 + cids 引用（幂等）
      deps.warehouseStore.removeContainer(cid);
      deps.stats.discard(cid);
      const cids = deps.warehouseStore.loadContainerIds(warehouse.id) ?? [];
      if (cids.includes(cid)) {
        deps.warehouseStore.saveContainerIds(
          warehouse.id,
          cids.filter((c) => c !== cid)
        );
      }
      continue;
    }
    if (block === undefined) continue; // register 分支理论上有 block（decidePendingAction 已分流）
    const container = createFromEntry(warehouse, deps, entry, block);
    if (container === undefined) {
      // 受支持容器类型但瞬时装配失败（如 inventory 组件尚未就绪）→ 保留待补，下轮再试；
      // 绝不在此删除——否则把配置/统计一起清掉（createFromEntry 对受支持类型应成功，失败即瞬态）
      continue;
    }
    registerContainer(warehouse, container);
    index?.onContainerAdded(container);
  }
}

/**
 * 由注册表条目 + 方块重建概念容器适配器（apply 配置字段）。
 * 返回 undefined：方块不支持/无 inventory/装配失败（区块未加载由调用方按 missing/air 处理）。
 */
function createFromEntry(
  warehouse: Warehouse,
  deps: WarehouseLoaderDeps,
  entry: ContainerEntry,
  block: import("@minecraft/server").Block
): Container | undefined {
  const container = deps.factory.create(block, entry.role);
  if (container === undefined) return undefined;
  container.enabled = entry.enabled;
  container.priority = entry.priority;
  container.warningEnabled = entry.warningEnabled ?? true; // 旧档缺字段 → 默认开
  container.familyEnabled = entry.familyEnabled ?? true; // 容器同族默认开；旧档缺字段 → 默认开
  container.whitelist = entry.whitelist ?? [];
  container.blacklist = entry.blacklist ?? [];
  return container;
}

/** 安全读取仓库维度下坐标方块（区块未加载/访问失败 → undefined，绝不让调用方崩） */
function readBlock(warehouse: Warehouse, loc: { x: number; y: number; z: number }): import("@minecraft/server").Block | undefined {
  try {
    return world.getDimension(warehouse.area.dimension).getBlock(loc) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * 卸载该仓容器（闲置/删仓安全释放）：清 containers/inputs + 待补集 + 丢弃成员统计缓存（冷读重算）。
 * 时机：容器卸载清内存（索引为纯运行时缓存，随进程重建，无须落盘）。
 */
export function unloadContainers(warehouse: Warehouse, deps: WarehouseLoaderDeps): void {
  for (const c of warehouse.containers.keys()) deps.stats.invalidate(c);
  warehouse.containers.clear();
  warehouse.inputs.clear();
  pendingReloadsOf(warehouse).clear();
}
