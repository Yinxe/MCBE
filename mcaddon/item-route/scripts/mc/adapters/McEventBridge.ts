// ─── 事件桥接：MC 世界事件 → 领域事件 + 索引增量维护 + 落盘时机 ──
// 这是"MC 无容器内容事件"问题的解法落点（设计 §5 三层兜底之第一层 代理信号）：
//   · playerInteractWithBlock —— 玩家手动改箱的"代理信号"→ reconcile 惰性
//     校验索引 + 统计失效 + 标记索引脏（把索引收敛交给下一次候选命中/下一次落盘）
//   · playerPlaceBlock —— 区域内放容器 → 工厂创建适配器 + 注册进仓库/索引 + 持久化容器注册表
//   · playerBreakBlock / blockExplode —— 拆容器 → 注销（双箱半拆：occupiedLocations 过滤）
//   · itemRouted（领域事件）—— 路由移动后 → markDirty 索引 + 统计失效（写穿透闭环）
//   · playerLeave —— 立即 flush（防丢会话增量）
//   · 主循环（每 5 tick）—— scheduler.tick() 驱动生命周期 + stats.tick() 递减预警冷却
//   · 批量落盘（每 100 tick）—— indexStore.flush()
// 关键：索引**实时内存准确 + 批量落盘**，玩家离开必 flush，崩溃丢量由重建兜底。
import { world, system, type Block } from "@minecraft/server";
import type { EventBus } from "../../core/events/DomainEvents";
import type { ItemIndex } from "../../core/index/ItemIndex";
import type { StatsService } from "../../core/stats/StatsService";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import { findContainerAt, findWarehouseAt } from "../../core/model/Area";
import { locationKey, type Location, type WarehouseId } from "../../core/model/types";
import { containerIdOf, primaryLocationOf, containerIdPointsTo } from "../../core/model/ContainerId";
import { registerContainer, unregisterContainer, rebaseContainer } from "../../core/model/ContainerRegistry";
import type { McIndexStore } from "../storage/McIndexStore";
import type { McContainerFactory } from "./McContainerFactory";
import type { McContainerAdapter } from "./McContainerAdapter";

export interface EventBridgeDeps {
  bus: EventBus;
  /** 每仓库索引解析（隔离：由 Scheduler 持有，激活加载/空闲卸载） */
  resolveIndex: (warehouseId: WarehouseId) => ItemIndex | undefined;
  stats: StatsService;
  scheduler: Scheduler;
  indexStore: McIndexStore;
  factory: McContainerFactory;
  /** 当前已加载仓库（Phase 4 填充） */
  warehouses: () => Warehouse[];
  /** 容器注册/注销后的持久化钩子（main.ts 接线：更新容器注册表） */
  onContainerRegistered?: (warehouse: Warehouse, container: Container) => void;
  onContainerUnregistered?: (warehouse: Warehouse, container: Container) => void;
}

const MAIN_TICK_INTERVAL = 5;   // 全局主任务：调度轮询
const FLUSH_INTERVAL = 100;     // 批量落盘间隔

export class McEventBridge {
  constructor(private readonly deps: EventBridgeDeps) {}

  start(): void {
    const { bus, stats, scheduler, indexStore, factory } = this.deps;

    // 路由移动物品 → 标记该仓库索引脏（写穿透闭环，批量落盘）
    // （统计增量失效已由 main.ts 的 itemRouted 订阅者负责，此处只管索引持久化）
    bus.itemRouted.subscribe((e) => {
      try {
        const index = this.deps.resolveIndex(e.warehouseId);
        if (index !== undefined) indexStore.markDirty(e.warehouseId, index.serialize());
      } catch (err) {
        console.warn(`[ItemRoute] 路由副作用失败: ${err}`);
      }
    });

    // 代理信号：玩家交互带容器方块 → 三层兜底第二层（reconcile 惰性校验）
    world.afterEvents.playerInteractWithBlock.subscribe((e) => {
      try {
        if (!e.isFirstEvent) return;
        const hit = this.locate(e.block);
        if (!hit) return;
        this.deps.resolveIndex(hit.warehouse.id)?.reconcile(hit.container);
        stats.invalidate(hit.container.id);
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: hit.warehouse.id, containerId: hit.container.id });
        const index = this.deps.resolveIndex(hit.warehouse.id);
        if (index !== undefined) indexStore.markDirty(hit.warehouse.id, index.serialize());
      } catch (err) {
        console.warn(`[ItemRoute] interact 事件处理失败: ${err}`);
      }
    });

    // 放置容器方块 → 注册（默认 single，漏斗强制 input 由工厂处理）
    // 若新块与已注册容器合并成双箱 → 合并进已有容器（扩展 occupied + 重定主 id），
    // 避免已注册单箱与新合并双箱共存/撞 id。
    world.afterEvents.playerPlaceBlock.subscribe((e) => {
      try {
        const dim = e.block.dimension.id;
        const loc = e.block.location;
        const warehouse = findWarehouseAt(this.deps.warehouses(), dim, { x: loc.x, y: loc.y, z: loc.z });
        if (warehouse === undefined) return;
        const container = factory.create(e.block, "single");
        if (container === undefined) return;

        if (container.occupiedLocations.length > 1) {
          // 双箱：找伙伴块是否已是注册容器
          const partnerLoc = container.occupiedLocations.find((l) => locationKey(l) !== locationKey(loc))!;
          const hit = findContainerAt(this.deps.warehouses(), dim, partnerLoc);
          if (hit !== undefined && hit.container.id !== container.id) {
            const existing = hit.container;
            const index = this.deps.resolveIndex(warehouse.id);
            // 拆旧 id 索引条目 + 旧键 → 并入新格并重定主 id → 迁移两 map 键 → 重建索引
            index?.onContainerRemoved(existing);
            const oldId = existing.id;
            existing.occupiedLocations.push({ x: loc.x, y: loc.y, z: loc.z });
            (existing as McContainerAdapter).rebaseId(containerIdOf(primaryLocationOf(existing.occupiedLocations)!, warehouse.area.dimension));
            rebaseContainer(warehouse, oldId, existing);
            index?.onContainerAdded(existing);
            stats.invalidate(existing.id);
            bus.containerChanged.trigger({ type: "container-changed", warehouseId: warehouse.id, containerId: existing.id });
            if (index !== undefined) indexStore.markDirty(warehouse.id, index.serialize());
            this.deps.onContainerRegistered?.(warehouse, existing);
            return;
          }
        }
        registerContainer(warehouse, container);
        const index = this.deps.resolveIndex(warehouse.id);
        index?.onContainerAdded(container);
        stats.invalidate(container.id);
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: warehouse.id, containerId: container.id });
        bus.containerAdded.trigger({ type: "container-added", warehouseId: warehouse.id, containerId: container.id, role: container.role });
        if (index !== undefined) indexStore.markDirty(warehouse.id, index.serialize());
        this.deps.onContainerRegistered?.(warehouse, container);
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
          stats.invalidate(container.id);
          bus.containerRemoved.trigger({ type: "container-removed", warehouseId: warehouse.id, containerId: container.id });
          this.deps.onContainerUnregistered?.(warehouse, container);
        } else if (containerIdPointsTo(container.id, loc, warehouse.area.dimension)) {
          // 半拆且拆的是主坐标（id 承载位）：重定 id 到幸存主坐标，
          // 否则 ID 悬空 + 后续在原主坐标新放容器会撞 ID
          const newId = containerIdOf(primaryLocationOf(container.occupiedLocations)!, warehouse.area.dimension);
          if (newId !== container.id) {
            index?.onContainerRemoved(container);
            const oldId = container.id;
            (container as McContainerAdapter).rebaseId(newId);
            rebaseContainer(warehouse, oldId, container);
            index?.onContainerAdded(container);
            stats.invalidate(container.id);
            this.deps.onContainerRegistered?.(warehouse, container);
          }
        } else {
          // 副半拆：几何变化但 ID 不变 → 仍需持久化注册表（否则重启按旧 locations 占用已消失坐标）
          this.deps.onContainerRegistered?.(warehouse, container);
        }
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: warehouse.id, containerId: container.id });
        if (index !== undefined) indexStore.markDirty(warehouse.id, index.serialize());
      } catch (err) {
        console.warn(`[ItemRoute] 移除事件处理失败: ${err}`);
      }
    };
    world.afterEvents.playerBreakBlock.subscribe((e) => unregister(e.block));
    world.afterEvents.blockExplode.subscribe((e) => unregister(e.block));

    // 玩家离开：立即批量落盘（防丢数据）
    world.afterEvents.playerLeave.subscribe(() => {
      try {
        indexStore.flush();
      } catch (err) {
        console.warn(`[ItemRoute] flush 失败: ${err}`);
      }
    });

    // 主任务：5 tick 调度 + 预警冷却递减 + 100 tick 批量落盘
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
    system.runInterval(() => {
      try {
        indexStore.flush();
      } catch (err) {
        console.warn(`[ItemRoute] flush 失败: ${err}`);
      }
    }, FLUSH_INTERVAL);
  }

  private locate(block: Block): { warehouse: Warehouse; container: Container } | undefined {
    const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
    return findContainerAt(this.deps.warehouses(), block.dimension.id, loc);
  }
}