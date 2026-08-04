// ─── 事件桥接：MC 世界事件 → 领域事件 + 索引增量维护 + 落盘时机 ──
import { world, system, type Block } from "@minecraft/server";
import type { EventBus } from "../../core/events/DomainEvents";
import type { ItemIndex } from "../../core/index/ItemIndex";
import type { StatsService } from "../../core/stats/StatsService";
import type { Scheduler } from "../../core/scheduling/Scheduler";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import { findContainerAt, findWarehouseAt } from "../../core/model/Area";
import { locationKey, type Location } from "../../core/model/types";
import type { McIndexStore } from "../storage/McIndexStore";
import type { McContainerFactory } from "./McContainerFactory";

export interface EventBridgeDeps {
  bus: EventBus;
  index: ItemIndex;
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
    const { bus, index, stats, scheduler, indexStore, factory } = this.deps;

    // 路由移动物品 → 标记索引脏 + 统计失效（写穿透闭环，v1 索引批量落盘）
    bus.itemRouted.subscribe((e) => {
      try {
        indexStore.markDirty(e.warehouseId, index.serialize());
        stats.invalidate(e.to);
      } catch (err) {
        console.warn(`[ItemRoute] 路由副作用失败: ${err}`);
      }
    });

    // 代理信号：玩家交互带容器方块 → 三层兜底第二层（verifyCandidate 惰性校验）
    world.afterEvents.playerInteractWithBlock.subscribe((e) => {
      try {
        if (!e.isFirstEvent) return;
        const hit = this.locate(e.block);
        if (!hit) return;
        index.verifyCandidate(hit.container);
        stats.invalidate(hit.container.id);
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: hit.warehouse.id, containerId: hit.container.id });
        indexStore.markDirty(hit.warehouse.id, index.serialize());
      } catch (err) {
        console.warn(`[ItemRoute] interact 事件处理失败: ${err}`);
      }
    });

    // 放置容器方块 → 注册（默认 single，漏斗强制 input 由工厂处理）
    world.afterEvents.playerPlaceBlock.subscribe((e) => {
      try {
        const dim = e.block.dimension.id;
        const loc = e.block.location;
        const warehouse = findWarehouseAt(this.deps.warehouses(), dim, { x: loc.x, y: loc.y, z: loc.z });
        if (warehouse === undefined) return;
        const container = factory.create(e.block, "single");
        if (container === undefined) return;
        warehouse.containers.set(container.id, container);
        index.onContainerAdded(container);
        stats.invalidate(container.id);
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: warehouse.id, containerId: container.id });
        indexStore.markDirty(warehouse.id, index.serialize());
        this.deps.onContainerRegistered?.(warehouse, container);
      } catch (err) {
        console.warn(`[ItemRoute] place 事件处理失败: ${err}`);
      }
    });

    // 破坏/爆炸移除容器方块 → 注销（双箱半拆：occupiedLocations 过滤）
    const unregister = (block: Block): void => {
      try {
        const hit = this.locate(block);
        if (!hit) return;
        const { warehouse, container } = hit;
        const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
        const idx = container.occupiedLocations.findIndex((l) => locationKey(l) === locationKey(loc));
        if (idx >= 0) container.occupiedLocations.splice(idx, 1);
        if (container.occupiedLocations.length === 0) {
          warehouse.containers.delete(container.id);
          index.onContainerRemoved(container);
          stats.invalidate(container.id);
          this.deps.onContainerUnregistered?.(warehouse, container);
        }
        bus.containerChanged.trigger({ type: "container-changed", warehouseId: warehouse.id, containerId: container.id });
        indexStore.markDirty(warehouse.id, index.serialize());
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

    // 主任务：5 tick 调度 + 100 tick 批量落盘
    system.runInterval(() => {
      try {
        scheduler.tick();
      } catch (err) {
        console.warn(`[ItemRoute] 主任务异常: ${err}`);
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