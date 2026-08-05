// ─── 调度器：生命周期状态机 + 每轮单槽处理 ────────────────
// mc 层每 5 tick 调一次 `tick()` 驱动"玩家邻近 → 激活/停用"；
// 激活的仓库拥有独立 interval（间隔 = processingSpeed tick），每轮处理一个 input slot。
//
// 生命周期（审查）：
//   inactive →（玩家在 16 格内）→ active（创建 interval）
//   active   →（玩家离开）→ deactivating（宽限期 40 次 tick，interval 仍运行）
//   deactivating →（玩家回来）→ active（interval 未停，恢复）
//                  →（宽限期结束）→ inactive（停 interval）
// 设计要点：
//   · deactivating 是"优雅宽限"，宽限期内仍继续分拣，避免玩家短暂离开就中断。
//   · 激活时创建 interval 若抛错 → 保持 inactive 下次重试（不吃死在半激活态）。
//   · `globalSpeedLimit` 把单仓速度 clamp 到上限；`setGlobalEnabled(false)` 立即
//     停全部 interval 并回到 inactive（全局开关）。
//   · `onAutoSort` 钩子：路由成功放入后，若目标混乱度超 autoSortThreshold 即整理
//     （v1 onDeposit 行为；由装配层接线到 OrganizeService）。
import type { Router } from "../routing/Router";
import type { IntervalHandle, IntervalScheduler } from "./IntervalScheduler";
import type { Warehouse } from "../model/Warehouse";
import type { Container } from "../model/Container";
import type { ContainerId, WarehouseId } from "../model/types";
import type { EventBus } from "../events/DomainEvents";

export type WarehouseLifecycle = "inactive" | "active" | "deactivating";

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
    private readonly deactivateDelayTicks = 40,
    /** 路由成功放入后的自动整理钩子（v1 onDeposit：混乱度超阈值即整理目标容器） */
    private readonly onAutoSort?: (warehouse: Warehouse, target: Container) => void
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
            // 创建 interval 失败 → 保持 inactive（下次 tick 重试），避免卡死
            try {
              rt.handle = this.createInterval(rt);
              rt.lifecycle = "active";
            } catch {
              rt.handle = undefined;
              rt.lifecycle = "inactive";
            }
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
        const routed = this.router.routeFrom(container, slot, rt.warehouse);
        if (routed !== undefined && this.onAutoSort !== undefined) {
          const target = rt.warehouse.containers.get(routed.to);
          if (target !== undefined) this.onAutoSort(rt.warehouse, target);
        }
        return; // 本轮只处理一个 slot
      }
    }
  }
}