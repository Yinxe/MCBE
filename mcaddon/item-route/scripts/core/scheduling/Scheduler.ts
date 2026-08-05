// ─── 调度器：生命周期状态机 + 每轮单槽处理 + 每仓库索引生命周期 ──
// mc 层每 5 tick 调一次 `tick()` 驱动"玩家邻近 → 激活/停用"；
// 激活的仓库拥有独立 interval（间隔 = processingSpeed tick），每轮处理一个 input slot。
//
// 生命周期（审查）：
//   inactive →（玩家在 16 格内）→ active（创建 interval + 加载仓库索引）
//   active   →（玩家离开）→ deactivating（宽限期 40 次 tick，interval 仍运行）
//   deactivating →（玩家回来）→ active（interval 未停，恢复）
//                  →（宽限期结束）→ inactive（停 interval）→ 空闲计时
//   inactive 空闲 30 分钟 → 卸载该仓库索引（内存隔离，见 IndexLifecycle）
//
// 每仓库数据隔离（本次重构核心）：
//   · Runtime 持有独立 `index?: ItemIndex`，**激活时加载、30 分钟空闲卸载**，
//     不再全局共用一个 ItemIndex（避免全玩家/全仓库索引挤在单例里）。
//   · 生产装配提供 `indexLifecycle`（load/unload，mc 层经 McIndexStore 存取）；
//     未提供时回退 `fallbackIndex`（共享实例，测试/非隔离场景用）。
//   · Router 每次路由按仓库拿到对应索引（routeFrom 第 4 参），实现按仓隔离。
// 设计要点：
//   · deactivating 是"优雅宽限"，宽限期内仍继续分拣，避免玩家短暂离开就中断。
//   · 激活时创建 interval 若抛错 → 保持 inactive 下次重试（不吃死在半激活态）。
//   · `globalSpeedLimit` 把单仓速度 clamp 到上限；`setGlobalEnabled(false)` 立即
//     停全部 interval 并回到 inactive（全局开关）。
//   · `onAutoSort` 钩子：路由成功放入后，若目标混乱度超 autoSortThreshold 即整理。
import type { Router, IndexGateway } from "../routing/Router";
import type { IntervalHandle, IntervalScheduler } from "./IntervalScheduler";
import type { Warehouse } from "../model/Warehouse";
import type { Container } from "../model/Container";
import type { WarehouseId } from "../model/types";
import type { EventBus } from "../events/DomainEvents";
import type { ItemIndex } from "../index/ItemIndex";

export type WarehouseLifecycle = "inactive" | "active" | "deactivating";

/** 邻近检测（mc 层实现：玩家位置轮询结果） */
export interface ProximityChecker {
  hasNearbyPlayer(warehouseId: WarehouseId): boolean;
}

/** 每仓库索引生命周期（数据隔离：激活加载/空闲卸载） */
export interface IndexLifecycle {
  /** 激活时加载该仓库索引（mc 层：读 McIndexStore → restore/重建） */
  load(warehouse: Warehouse): ItemIndex;
  /** 空闲卸载（mc 层：落盘最新快照后释放引用） */
  unload(warehouse: Warehouse, index: ItemIndex): void;
}

/** 调度器可选配置（全部可选，默认值见下） */
export interface SchedulerOptions {
  /** 路由成功放入后的自动整理钩子（v1 onDeposit） */
  onAutoSort?: (warehouse: Warehouse, target: Container) => void;
  /** 每仓库索引生命周期（未提供时用 fallbackIndex 共享实例） */
  indexLifecycle?: IndexLifecycle;
  /** 空闲卸载阈值（**墙钟毫秒**，与调度 tick 节奏解耦；默认 30 分钟） */
  idleUnloadMs?: number;
  /** 时钟注入（默认 Date.now；测试可用假时钟） */
  now?: () => number;
  /** 共享索引回退（测试/未隔离场景；生产不传，用 per-warehouse） */
  fallbackIndex?: ItemIndex;
}

/** 空闲卸载阈值（墙钟毫秒；30 分钟。用墙钟而非 tick 计数，避免耦合 mc 主循环节奏） */
export const DEFAULT_IDLE_UNLOAD_MS = 30 * 60 * 1000;

interface Runtime {
  warehouse: Warehouse;
  lifecycle: WarehouseLifecycle;
  handle?: IntervalHandle;
  inputCursor: number;
  deactivateCounter: number;
  /** 激活时加载的仓库级索引（空闲超时卸载置 undefined） */
  index?: ItemIndex;
  /** 该仓库进入 inactive 的时间戳（Date.now 墙钟）；未 inactive 为 undefined */
  inactiveSince?: number;
}

export class Scheduler {
  private runtimes = new Map<WarehouseId, Runtime>();
  private globalEnabled = true;
  private readonly now: () => number;

  constructor(
    private readonly router: Router,
    private readonly intervals: IntervalScheduler,
    private readonly proximity: ProximityChecker,
    private readonly bus: EventBus,
    private readonly globalSpeedLimit = 20,
    private readonly deactivateDelayTicks = 40,
    private readonly options: SchedulerOptions = {}
  ) {
    this.now = options.now ?? Date.now;
  }

  registerWarehouse(warehouse: Warehouse): void {
    if (this.runtimes.has(warehouse.id)) return;
    this.runtimes.set(warehouse.id, {
      warehouse,
      lifecycle: "inactive",
      inputCursor: 0,
      deactivateCounter: 0,
    });
  }

  /** 删除仓库：强制停 interval + 卸载索引 + 清理 runtime */
  unregisterWarehouse(warehouseId: WarehouseId): void {
    const rt = this.runtimes.get(warehouseId);
    if (rt?.handle) rt.handle.stop();
    if (rt?.index !== undefined && this.options.indexLifecycle !== undefined) {
      this.options.indexLifecycle.unload(rt.warehouse, rt.index);
    }
    this.runtimes.delete(warehouseId);
  }

  getLifecycle(warehouseId: WarehouseId): WarehouseLifecycle | undefined {
    return this.runtimes.get(warehouseId)?.lifecycle;
  }

  /** 取该仓库当前加载的索引（未激活/已卸载返回 undefined；供事件桥接查询） */
  getIndex(warehouseId: WarehouseId): ItemIndex | undefined {
    return this.runtimes.get(warehouseId)?.index;
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
        rt.inactiveSince = this.now(); // 全局关 → 立即开始空闲计时
      }
    }
  }

  /** 全局主任务（mc 层每 5 tick 调用）：驱动生命周期 + 索引加载/卸载 */
  tick(): void {
    for (const rt of this.runtimes.values()) {
      const nearby = this.globalEnabled && this.proximity.hasNearbyPlayer(rt.warehouse.id);
      switch (rt.lifecycle) {
        case "inactive":
          if (nearby) {
            // 激活：加载该仓库索引（未加载才加载）+ 创建 interval
            try {
              if (rt.index === undefined) rt.index = this.resolveIndex(rt.warehouse);
              rt.handle = this.createInterval(rt);
              rt.inactiveSince = undefined;
              rt.lifecycle = "active";
              this.emitLifecycle(rt, "inactive", "active");
            } catch {
              rt.handle = undefined;
              rt.lifecycle = "inactive";
            }
          } else {
            // 空闲卸载：距本仓最近进入 inactive 超过 idleUnloadMs（墙钟）→ 卸载索引
            const since = rt.inactiveSince ?? this.now();
            const idleMs = this.options.idleUnloadMs ?? DEFAULT_IDLE_UNLOAD_MS;
            if (rt.index !== undefined && this.options.indexLifecycle !== undefined && this.now() - since > idleMs) {
              this.options.indexLifecycle.unload(rt.warehouse, rt.index);
              rt.index = undefined;
              rt.inactiveSince = undefined;
            }
          }
          break;
        case "active":
          if (!nearby) {
            rt.lifecycle = "deactivating";
            rt.deactivateCounter = this.deactivateDelayTicks;
            this.emitLifecycle(rt, "active", "deactivating");
          }
          break;
        case "deactivating":
          if (nearby) {
            rt.lifecycle = "active"; // 玩家回来：取消停用（interval 未停）
            this.emitLifecycle(rt, "deactivating", "active");
          } else {
            rt.deactivateCounter--;
            if (rt.deactivateCounter <= 0) {
              rt.handle?.stop();
              rt.handle = undefined;
              rt.lifecycle = "inactive";
              rt.inactiveSince = this.now(); // 从此进入空闲计时（墙钟）
              this.emitLifecycle(rt, "deactivating", "inactive");
            }
          }
          break;
      }
    }
  }

  // ── 私有方法 ───────────────────────────────────────────
  /** 生命周期迁移事件（供 mc 层通知附近成员） */
  private emitLifecycle(rt: Runtime, from: WarehouseLifecycle, to: WarehouseLifecycle): void {
    this.bus.lifecycleChanged.trigger({ type: "lifecycle-changed", warehouseId: rt.warehouse.id, from, to });
  }

  /** 解析该仓库的索引：优先生命周期加载；否则回退共享实例 */
  private resolveIndex(warehouse: Warehouse): ItemIndex | undefined {
    return this.options.indexLifecycle?.load(warehouse) ?? this.options.fallbackIndex;
  }

  private clampSpeed(speed: number): number {
    return Math.min(Math.max(1, speed), this.globalSpeedLimit);
  }

  private createInterval(rt: Runtime): IntervalHandle {
    return this.intervals.createInterval(() => this.processOnce(rt), this.clampSpeed(rt.warehouse.settings.processingSpeed));
  }

  /** 每轮：处理一个输入容器的非空 slot（用该仓库自己的索引路由） */
  private processOnce(rt: Runtime): void {
    if (!rt.warehouse.settings.sortingEnabled) return;
    const index = rt.index; // 该仓库激活时加载的索引（隔离）
    if (index === undefined) return;
    const ids = [...rt.warehouse.containers.keys()];
    if (ids.length === 0) return;
    for (let step = 0; step < ids.length; step++) {
      const id = ids[rt.inputCursor % ids.length]!;
      rt.inputCursor++;
      const container = rt.warehouse.containers.get(id);
      if (!container || container.role !== "input" || !container.enabled) continue;
      const slot = container.firstItem(); // 首个非空槽（委托原生，省去内部 for）
      if (slot === undefined) continue;
      const routed = this.router.routeFrom(container, slot, rt.warehouse, index);
      if (routed !== undefined && this.options.onAutoSort !== undefined) {
        const target = rt.warehouse.containers.get(routed.to);
        if (target !== undefined) this.options.onAutoSort(rt.warehouse, target);
      }
      return; // 本轮只处理一个 slot
    }
  }
}

export type { IndexGateway };