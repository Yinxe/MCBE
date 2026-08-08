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
//   · 生产装配提供 `indexLifecycle`（load/unload，mc 层纯运行时重建：激活全扫/卸载清内存）；
//     未提供时回退 `fallbackIndex`（共享实例，测试/非隔离场景用）。
//   · Router 每次路由按仓库拿到对应索引（routeFrom 第 4 参），实现按仓隔离。
// 设计要点：
//   · deactivating 是"优雅宽限"，宽限期内仍继续分拣，避免玩家短暂离开就中断。
//   · 激活时创建 interval 若抛错 → 保持 inactive 下次重试（不吃死在半激活态）。
//   · `globalSpeedLimit` 把单仓速度 clamp 到上限；`setGlobalEnabled(false)` 立即
//     停全部 interval 并回到 inactive（全局开关）。
//   · **强制阻塞**：每轮只处理第一个非空输入的首个物品，路由失败即阻塞（不落到
//     低优先输入）——堵住才让玩家发现并扩容/加分类。路由成功的副作用（统计增量/
//     混乱度→自动整理/容量预警）由 itemRouted 事件的多个订阅者驱动，Scheduler 不再内联。
//   · 运转开关三级：全局 globalEnabled > 每仓 settings.routingEnabled > 每容器 enabled。
//     routingEnabled=false 时该仓 processOnce 直接返回（完全停运）。
import type { Router, IndexGateway } from "../routing/Router";
import type { IntervalHandle, IntervalScheduler } from "./IntervalScheduler";
import type { Warehouse } from "../model/Warehouse";
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
  /** 激活时加载该仓库索引（mc 层纯运行时重建：按真实内容全量扫描，不持久化） */
  load(warehouse: Warehouse): ItemIndex;
  /** 激活后待补容器 pump（可选）：随该仓自己的 routing interval（每轮）被调用——对 pendingReloads
   * 逐容器重读方块，区块加载则注册、空气/非容器则移除（见 WarehouseLoader.pumpPendingReloads）。幂等。 */
  refresh?(warehouse: Warehouse, index: ItemIndex): void;
  /** 空闲卸载（mc 层：落盘最新快照后释放引用） */
  unload(warehouse: Warehouse, index: ItemIndex): void;
}

/** 调度器可选配置（全部可选，默认值见下） */
export interface SchedulerOptions {
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
  deactivateCounter: number;
  /** 激活时加载的仓库级索引（空闲超时卸载置 undefined） */
  index?: ItemIndex;
  /** 该仓库进入 inactive 的时间戳（Date.now 墙钟）；未 inactive 为 undefined */
  inactiveSince?: number;
  /** 当前处于阻塞态的输入容器 id（inputBlocked 事件仅在"进入阻塞"时触发一次，防每 tick 刷事件） */
  blockedInputs: Set<string>;
}

/**
 * 调度器：每仓运行时（Runtime）按"邻近激活 / 空闲卸载"生命周期驱动路由 interval。
 *  - tick()（mc 层每 5 tick 调）轮询邻近判定 → inactive↔active↔deactivating 状态机，
 *    激活时经 indexLifecycle.load 加载索引（同刻容器按需加载）、卸载时清理索引与容器（纯运行时，不落盘）。
 *  - processOnce() 取输入容器逐格路由，失败阻塞（强制可见）；input-blocked 事件触发通知。
 *  - 全局开关（globalEnabled）/ 单仓速度（processingSpeed）在此统一口径。
 * 可注入 { router, intervals, proximity, bus, indexLifecycle }，内存实现可测。
 */
export class Scheduler {
  private runtimes = new Map<WarehouseId, Runtime>();
  private globalEnabled = true;
  private readonly now: () => number;

  constructor(
    private readonly router: Router,
    private readonly intervals: IntervalScheduler,
    private readonly proximity: ProximityChecker,
    private readonly bus: EventBus,
    private globalSpeedLimit = 20,
    /** 停用宽限（**scheduler.tick() 次数**；主循环每 5 game-tick 调一次 tick → 默认 4 ≈ 1 秒） */
    private readonly deactivateDelayTicks = 4,
    private readonly options: SchedulerOptions = {}
  ) {
    this.now = options.now ?? Date.now;
  }

  /** 运行时改全局速度上限（**最快速度**：tick 越小越快）：违规（快于上限）仓库速度提到上限，合规不动；重建 active/deactivating 仓 interval */
  setGlobalSpeedLimit(limit: number): void {
    this.globalSpeedLimit = limit;
    for (const rt of this.runtimes.values()) {
      if (rt.warehouse.settings.processingSpeed < limit) rt.warehouse.settings.processingSpeed = limit;
      if ((rt.lifecycle === "active" || rt.lifecycle === "deactivating") && rt.handle) {
        rt.handle.stop();
        rt.handle = this.createInterval(rt);
      }
    }
  }

  registerWarehouse(warehouse: Warehouse): void {
    if (this.runtimes.has(warehouse.id)) return;
    this.runtimes.set(warehouse.id, {
      warehouse,
      lifecycle: "inactive",
      deactivateCounter: 0,
      blockedInputs: new Set(),
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

  /** 全局分拣开关状态（HUD 展示用） */
  get isGlobalEnabled(): boolean {
    return this.globalEnabled;
  }

  /** 当前处于阻塞态（进入阻塞后未疏通）的输入容器数（HUD 展示用） */
  blockedInputCount(warehouseId: WarehouseId): number {
    return this.runtimes.get(warehouseId)?.blockedInputs.size ?? 0;
  }

  /** 当前处于阻塞态的输入容器 id（只读视图，HUD 据此累加真实堵塞槽数）。 */
  blockedInputIds(warehouseId: WarehouseId): Iterable<string> {
    return this.runtimes.get(warehouseId)?.blockedInputs ?? [];
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
    // active 与 deactivating（interval 仍在跑）都立即重建，避免中途改速静默失效
    if ((rt.lifecycle === "active" || rt.lifecycle === "deactivating") && rt.handle) {
      rt.handle.stop();
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
        rt.blockedInputs.clear(); // 全局关 → 阻塞态清空（HUD/事件不残留）
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
            // ⚠️ 立即停止 interval（不继续分拣）：玩家已离开，仓库所在区块可能很快卸载，
            //    继续访问未加载区块的方块容器有数据风险（不冒险）。deactivating 仅作短暂
            //    通知过渡（玩家若很快回来则恢复）。
            rt.handle?.stop();
            rt.handle = undefined;
            this.emitLifecycle(rt, "active", "deactivating");
          }
          break;
        case "deactivating":
          if (nearby) {
            rt.lifecycle = "active"; // 玩家回来：重新创建 interval（此前已停）
            try {
              rt.handle = this.createInterval(rt);
              this.emitLifecycle(rt, "deactivating", "active");
            } catch {
              rt.lifecycle = "deactivating"; // interval 创建失败 → 保持停用态重试
            }
          } else {
            rt.deactivateCounter--;
            if (rt.deactivateCounter <= 0) {
              rt.lifecycle = "inactive";
              rt.blockedInputs.clear(); // 进入停用 → 阻塞态清空（HUD/事件不残留）
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
    // 全局"最快速度"下限（tick 越小越快）：仓库不得快于 globalSpeedLimit（v1 clampSpeed 口径），
    // 慢于上限（合规）不动；上限 40（最慢）兜底。
    return Math.max(this.globalSpeedLimit, Math.min(40, speed));
  }

  private createInterval(rt: Runtime): IntervalHandle {
    return this.intervals.createInterval(
      () => {
        this.processOnce(rt);
        // 待补容器 pump：随该仓**自己的路由节奏**（interval 仅 active 存在）每轮重试跳过注册的
        // 容器——区块慢加载的等区块好了注册、空气/非容器确认移除（见 pumpPendingReloads）。
        // 与路由同频 = 激活后第一个 interval 周期（默认 ~1s）即覆盖"延迟初始化"；失败隔离不影响路由。
        if (this.options.indexLifecycle?.refresh !== undefined && rt.index !== undefined) {
          try {
            this.options.indexLifecycle.refresh(rt.warehouse, rt.index);
          } catch {
            // 补注册失败（区块个别未加载）→ 下轮再试，不影响路由
          }
        }
      },
      this.clampSpeed(rt.warehouse.settings.processingSpeed)
    );
  }

  /**
   * 每轮：只处理**该仓启用的输入容器**（`warehouse.inputs` 维护镜像，零全仓过滤），
   * 按 priority 升序（数字小优先）取第一个非空输入。
   * - 空判定用 O(1) `usedSlots`，仅对真正要路由的容器做 firstNoEmptyItem 扫描。
   * - **强制阻塞**：路由成功 → 完成本轮；路由失败（目标满/无候选/禁用）→ 同样结束本轮，
   *   不落到低优先输入——物品留在输入容器，拥堵暴露给玩家，及时扩容/加分类。
   * - 路由成功的副作用（统计增量/混乱度→自动整理/容量预警）由 itemRouted 事件订阅者驱动。
   */
  private processOnce(rt: Runtime): void {
    if (!rt.warehouse.settings.routingEnabled) return;
    const index = rt.index; // 该仓库激活时加载的索引（隔离）
    if (index === undefined) return;
    const inputs = [...rt.warehouse.inputs.values()].sort(
      (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    for (const container of inputs) {
      if (container.usedSlots === 0) {
        // 空输入：解除阻塞态（物品已清/路由走 → HUD 不再残留"堵塞 N 格"、防误报事件）
        rt.blockedInputs.delete(container.id);
        continue;
      }
      const slot = container.firstNoEmptyItem(); // 首个非空槽（手封装线性扫描）
      if (slot === undefined) continue;
      const stack = container.getItem(slot);
      // 仓库级黑名单：这些物品**永不进入本仓库**（也不索引路由）——遇必阻塞，直接终结本轮
      // ⚠️ `blacklist` 为空值防护：旧档仓库 meta 可能缺该字段 → `undefined.includes` 会崩掉整轮
      if (stack !== undefined && (rt.warehouse.settings.blacklist ?? []).includes(stack.itemId)) {
        this.blockInput(rt, container, slot);
        return;
      }
      const routed = this.router.routeFrom(container, slot, rt.warehouse, index);
      if (routed === undefined) {
        this.blockInput(rt, container, slot);
      } else {
        rt.blockedInputs.delete(container.id); // 疏通 → 解除阻塞态（下次再堵时重新触发）
      }
      return; // 无论成败，本轮到此为止；失败即阻塞该输入，不处理低优先输入
    }
  }

  /** 输入阻塞落点：仅在"进入阻塞态"时触发一次（防每 tick 刷事件），通知层再防抖提醒 */
  private blockInput(rt: Runtime, container: import("../model/Container").Container, slot: number): void {
    if (rt.blockedInputs.has(container.id)) return;
    rt.blockedInputs.add(container.id);
    const stack = container.getItem(slot);
    this.bus.inputBlocked.trigger({
      type: "input-blocked",
      warehouseId: rt.warehouse.id,
      containerId: container.id,
      itemId: stack?.itemId ?? "",
      amount: stack?.amount ?? 0,
    });
  }
}

export type { IndexGateway };
