// ─── 调度器：5 tick 全局主任务 + 仓库级独立 interval ──
import type { Router } from "../routing/Router";
import type { IntervalHandle, IntervalScheduler } from "./IntervalScheduler";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, WarehouseId } from "../model/types";
import type { EventBus } from "../events/DomainEvents";

export type WarehouseLifecycle = "inactive" | "activating" | "active" | "deactivating";

/** 邻近检测（mc 层实现：玩家位置轮询结果） */
export interface ProximityChecker {
  hasNearbyPlayer(warehouseId: WarehouseId): boolean;
}

interface Runtime {
  warehouse: Warehouse;
  lifecycle: WarehouseLifecycle;
  handle?: IntervalHandle;
  inputCursor: number;
  slotCursors: Map<ContainerId, number>;
  deactivateCounter: number;
}

export class Scheduler {
  private runtimes = new Map<WarehouseId, Runtime>();
  private globalEnabled = true;

  constructor(
    private readonly router: Router,
    private readonly intervals: IntervalScheduler,
    private readonly proximity: ProximityChecker,
    private readonly bus: EventBus,
    private readonly globalSpeedLimit = 20,
    private readonly deactivateDelayTicks = 40
  ) {}

  registerWarehouse(warehouse: Warehouse): void {
    if (this.runtimes.has(warehouse.id)) return;
    this.runtimes.set(warehouse.id, {
      warehouse,
      lifecycle: "inactive",
      inputCursor: 0,
      slotCursors: new Map(),
      deactivateCounter: 0,
    });
  }

  /** 删除仓库：强制停 interval + 清理 runtime */
  unregisterWarehouse(warehouseId: WarehouseId): void {
    const rt = this.runtimes.get(warehouseId);
    if (rt?.handle) rt.handle.stop();
    this.runtimes.delete(warehouseId);
  }

  getLifecycle(warehouseId: WarehouseId): WarehouseLifecycle | undefined {
    return this.runtimes.get(warehouseId)?.lifecycle;
  }

  /** 测试辅助：当前 interval 间隔（undefined = 未激活） */
  getIntervalTicks(warehouseId: WarehouseId): number | undefined {
    const rt = this.runtimes.get(warehouseId);
    return rt?.lifecycle === "active" && rt.handle ? rt.warehouse.settings.processingSpeed : undefined;
  }

  setProcessingSpeed(warehouseId: WarehouseId, speed: number): void {
    const rt = this.runtimes.get(warehouseId);
    if (!rt) return;
    rt.warehouse.settings.processingSpeed = this.clampSpeed(speed);
    if (rt.lifecycle === "active") {
      rt.handle?.stop();
      rt.handle = this.createInterval(rt);
    }
  }

  setGlobalEnabled(enabled: boolean): void {
    this.globalEnabled = enabled;
    for (const rt of this.runtimes.values()) {
      if (!enabled) {
        rt.handle?.stop();
        rt.handle = undefined;
        rt.lifecycle = "inactive";
      }
    }
  }

  /** 全局主任务（mc 层每 5 tick 调用）：驱动生命周期 + 冷却 */
  tick(): void {
    for (const rt of this.runtimes.values()) {
      const nearby = this.globalEnabled && this.proximity.hasNearbyPlayer(rt.warehouse.id);
      switch (rt.lifecycle) {
        case "inactive":
          if (nearby) {
            rt.lifecycle = "activating";
            rt.handle = this.createInterval(rt);
            rt.lifecycle = "active";
          }
          break;
        case "active":
          if (!nearby) {
            rt.lifecycle = "deactivating";
            rt.deactivateCounter = this.deactivateDelayTicks;
          }
          break;
        case "deactivating":
          if (nearby) {
            rt.lifecycle = "active"; // 玩家回来：取消停用（interval 未停）
          } else {
            rt.deactivateCounter--;
            if (rt.deactivateCounter <= 0) {
              rt.handle?.stop();
              rt.handle = undefined;
              rt.lifecycle = "inactive";
            }
          }
          break;
      }
    }
  }

  // ── 私有方法 ───────────────────────────────────────────
  private clampSpeed(speed: number): number {
    return Math.min(Math.max(1, speed), this.globalSpeedLimit);
  }

  private createInterval(rt: Runtime): IntervalHandle {
    return this.intervals.createInterval(() => this.processOnce(rt), this.clampSpeed(rt.warehouse.settings.processingSpeed));
  }

  /** 每轮：处理一个输入容器的非空 slot */
  private processOnce(rt: Runtime): void {
    if (!rt.warehouse.settings.sortingEnabled) return;
    const ids = [...rt.warehouse.containers.keys()];
    if (ids.length === 0) return;
    for (let step = 0; step < ids.length; step++) {
      const id = ids[rt.inputCursor % ids.length]!;
      rt.inputCursor++;
      const container = rt.warehouse.containers.get(id);
      if (!container || container.role !== "input" || !container.enabled) continue;
      const start = rt.slotCursors.get(id) ?? 0;
      const capacity = container.capacity;
      for (let offset = 0; offset < capacity; offset++) {
        const slot = (start + offset) % capacity;
        const item = container.getItem(slot);
        if (item === undefined) continue;
        rt.slotCursors.set(id, slot + 1);
        this.router.routeFrom(container, slot, rt.warehouse);
        return; // 本轮只处理一个 slot
      }
    }
  }
}