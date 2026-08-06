// ─── 事件桥接：MC 世界事件 → 领域事件 + 索引/统计内存联动 ──
// 这是"MC 无容器内容事件"问题的解法落点（三层兜底之第一层 代理信号）：
//   · playerInteractWithBlock —— 玩家手动改箱的"代理信号"→ reconcile 惰性校验索引 + 统计失效
//   · playerPlaceBlock —— 区域内放容器 → 工厂创建适配器 + 注册进仓库/索引 + 发结构事件
//   · playerBreakBlock / blockExplode —— 拆容器 → 注销（双箱半拆：occupiedLocations 过滤 + 主坐标重定）
//   · 结构变更发 **containerAdded / containerRegistryChanged / containerRemoved**，
//     持久化由 main.ts 的中央订阅订阅者负责（每容器一条键、事件驱动）——此处只管
//     内存注册表/索引联动，不亲自写 DP、无 markDirty、无定时 flush。
//   · 主循环（每 5 tick）—— scheduler.tick() 驱动路由/生命周期 + stats.tick() 递减预警冷却
// 路由移动（itemRouted）的索引/统计：itemRouted → main.ts 扫描目标 → containerScanned
// （统计单容器写穿）；索引 itemRouted 不落盘（卸载/离仓时按每容器条目落盘，重载后惰性自愈）。
import { world, system, type Block } from "@minecraft/server";
import type { EventBus } from "../../core/events/DomainEvents";
import type { ItemIndex } from "../../core/index/ItemIndex";
import type { StatsService } from "../../core/stats/StatsService";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import { findContainerAt, findWarehouseAt } from "../../core/model/Area";
import { locationKey, type ContainerId, type Location, type WarehouseId } from "../../core/model/types";
import { containerIdOf, primaryLocationOf, containerIdPointsTo } from "../../core/model/ContainerId";
import { registerContainer, unregisterContainer, rebaseContainer } from "../../core/model/ContainerRegistry";
import type { McContainerFactory } from "./McContainerFactory";
import type { McContainerAdapter } from "./McContainerAdapter";

export interface EventBridgeDeps {
  bus: EventBus;
  /** 每仓库索引解析（隔离：由 Scheduler 持有，激活加载/空闲卸载） */
  resolveIndex: (warehouseId: WarehouseId) => ItemIndex | undefined;
  stats: StatsService;
  scheduler: Scheduler;
  factory: McContainerFactory;
  /** 当前已加载仓库（Phase 4 填充） */
  warehouses: () => Warehouse[];
}

const MAIN_TICK_INTERVAL = 5;   // 全局主任务：调度轮询（路由/生命周期，非持久化）

export class McEventBridge {
  constructor(private readonly deps: EventBridgeDeps) {}

  start(): void {
    const { bus, stats, scheduler, factory } = this.deps;

    // 代理信号：玩家交互带容器方块 → 三层兜底第二层（reconcile 惰性校验）+ 统计失效
    world.afterEvents.playerInteractWithBlock.subscribe((e) => {
      try {
        if (!e.isFirstEvent) return;
        const hit = this.locate(e.block);
        if (!hit) return;
        this.deps.resolveIndex(hit.warehouse.id)?.reconcile(hit.container);
        stats.invalidate(hit.container.id);
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: hit.warehouse.id, containerId: hit.container.id });
      } catch (err) {
        console.warn(`[ItemRoute] interact 事件处理失败: ${err}`);
      }
    });

    // 放置容器方块 → 注册（默认按仓库角色，漏斗强制 input 由工厂处理）
    // 若新块与已注册容器合并成双箱 → 合并进已有容器（扩展 occupied + 重定主 id），
    // 避免已注册单箱与新合并双箱共存/撞 id。
    world.afterEvents.playerPlaceBlock.subscribe((e) => {
      try {
        const dim = e.block.dimension.id;
        const loc = e.block.location;
        const warehouse = findWarehouseAt(this.deps.warehouses(), dim, { x: loc.x, y: loc.y, z: loc.z });
        if (warehouse === undefined) return;
        // 新放置容器按仓库默认角色/启用注册（漏斗仍强制 input，见工厂）
        const container = factory.create(e.block, warehouse.settings.defaultContainerRole);
        if (container === undefined) return;
        container.enabled = warehouse.settings.defaultContainerEnabled;

        if (container.occupiedLocations.length > 1) {
          // 双箱：找伙伴块是否已是注册容器
          const partnerLoc = container.occupiedLocations.find((l) => locationKey(l) !== locationKey(loc))!;
          const hit = findContainerAt(this.deps.warehouses(), dim, partnerLoc);
          if (hit !== undefined && hit.container.id !== container.id) {
            const existing = hit.container;
            const index = this.deps.resolveIndex(warehouse.id);
            // 拆旧 id 索引条目 → 并入新格并重定主 id → 迁移两 map 键 → 重建索引
            index?.onContainerRemoved(existing);
            const oldId = existing.id;
            stats.discard(oldId); // 合并后容器重定 id → 旧 id 统计键失效
            existing.occupiedLocations.push({ x: loc.x, y: loc.y, z: loc.z });
            // 重绑定到合并后共享库存句柄（工厂新建 adapter 持有最新 mc，覆盖 existing 旧单箱引用）
            (existing as McContainerAdapter).rebindMc((container as McContainerAdapter).getMc());
            (existing as McContainerAdapter).rebaseId(containerIdOf(primaryLocationOf(existing.occupiedLocations)!, warehouse.area.dimension));
            rebaseContainer(warehouse, oldId, existing);
            index?.onContainerAdded(existing);
            stats.invalidate(existing.id);
            // 持久化（注册表/索引/统计清旧键）由中央订阅订阅 containerRegistryChanged 负责
            bus.containerRegistryChanged.trigger({
              type: "container-registry-changed",
              warehouseId: warehouse.id,
              containerId: existing.id,
              oldId,
            });
            return;
          }
        }
        registerContainer(warehouse, container);
        const index = this.deps.resolveIndex(warehouse.id);
        index?.onContainerAdded(container);
        stats.invalidate(container.id);
        bus.containerAdded.trigger({ type: "container-added", warehouseId: warehouse.id, containerId: container.id, role: container.role });
      } catch (err) {
        console.warn(`[ItemRoute] place 事件处理失败: ${err}`);
      }
    });

    // 破坏/爆炸移除容器方块 → 注销（双箱半拆：occupiedLocations 过滤 + 主坐标重定）
    const unregister = (block: Block): void => {
      try {
        const hit = this.locate(block);
        if (!hit) return;
        const { warehouse, container } = hit;
        const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
        const idx = container.occupiedLocations.findIndex((l) => locationKey(l) === locationKey(loc));
        if (idx >= 0) container.occupiedLocations.splice(idx, 1);
        const index = this.deps.resolveIndex(warehouse.id);
        if (container.occupiedLocations.length === 0) {
          // 完全拆除
          unregisterContainer(warehouse, container.id);
          index?.onContainerRemoved(container);
          stats.discard(container.id); // 容器已移除 → 清其统计键（每容器一条）
          bus.containerRemoved.trigger({ type: "container-removed", warehouseId: warehouse.id, containerId: container.id });
        } else if (containerIdPointsTo(container.id, loc, warehouse.area.dimension)) {
          // 半拆且拆的是主坐标（id 承载位）：重定 id 到幸存主坐标，
          // 否则 ID 悬空 + 后续在原主坐标新放容器会撞 ID
          const newId = containerIdOf(primaryLocationOf(container.occupiedLocations)!, warehouse.area.dimension);
          if (newId !== container.id) {
            index?.onContainerRemoved(container);
            const oldId = container.id;
            stats.discard(oldId); // 旧 id 统计键失效（容器已重定 id）
            (container as McContainerAdapter).rebaseId(newId);
            rebaseContainer(warehouse, oldId, container);
            index?.onContainerAdded(container);
            stats.invalidate(container.id);
            bus.containerRegistryChanged.trigger({
              type: "container-registry-changed",
              warehouseId: warehouse.id,
              containerId: container.id,
              oldId,
            });
          }
        } else {
          // 副半拆：几何变化但 ID 不变 → 仍需持久化注册表（否则重启按旧 locations 占用已消失坐标）
          bus.containerRegistryChanged.trigger({
            type: "container-registry-changed",
            warehouseId: warehouse.id,
            containerId: container.id,
          });
        }
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: warehouse.id, containerId: container.id });
      } catch (err) {
        console.warn(`[ItemRoute] 移除事件处理失败: ${err}`);
      }
    };
    world.afterEvents.playerBreakBlock.subscribe((e) => unregister(e.block));
    world.afterEvents.blockExplode.subscribe((e) => unregister(e.block));

    // 主任务：5 tick 调度 + 预警冷却递减（无持久化定时器——持久化全部事件驱动）
    system.runInterval(() => {
      try {
        scheduler.tick();
      } catch (err) {
        console.warn(`[ItemRoute] 主任务异常: ${err}`);
      }
      try {
        stats.tick(); // 预警冷却递减（否则冷却永不失效，预警只触发一次）
      } catch (err) {
        console.warn(`[ItemRoute] 统计冷却异常: ${err}`);
      }
    }, MAIN_TICK_INTERVAL);
  }

  private locate(block: Block): { warehouse: Warehouse; container: Container } | undefined {
    const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
    return findContainerAt(this.deps.warehouses(), block.dimension.id, loc);
  }
}