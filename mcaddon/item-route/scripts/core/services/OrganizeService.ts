// ─── 整理服务：分析/执行 + 详细结果 + 事件 ────────────────
// 封装 Organizer 的 analyze+apply，返回 v1 smartwarehouse 风格的详细整理结果
// （moves/skipped/chaosBefore→chaosAfter/前后堆叠与类型数/perType 明细/容量），
// 供手动整理命令经 OrganizeFormatter 展示。
//
// **整理后不重建索引**（v1 经验 + 三层兜底设计）：
//   整理只做同型归并——目标容器本就含该类型（候选条目不变），源容器（杂项/单物/多物）
//   即使清空某类型，路由候选条目也只会**过期而不会新增**；过期条目由策略侧惰性校验
//   （RouteStrategy.reconcile）在下次命中时按真实内容自愈，故无需此处全量重建。
// 对外仅发事件：organize-completed（汇总）+ container-changed（逐涉及容器，供统计失效/成员通知）。
import type { Organizer } from "../organizing/Organizer";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId } from "../model/types";
import type { MoveJournal } from "../routing/Move";
import type { EventBus } from "../events/DomainEvents";

/** 某物品种类的堆叠/数量汇总（perType 条目） */
export interface OrganizeTypeStat {
  stacks: number;
  total: number;
}

/** 整理结果（v1 风格明细，供手动整理命令/UI 展示） */
export interface OrganizeResult {
  ok: boolean;
  /** 实际合并/移动的堆数 */
  moves: number;
  /** 跳过动作数（目标满/不可堆叠） */
  skipped: number;
  /** 计划动作数 */
  actionsPlanned: number;
  /** 涉及容器 ID（去重） */
  touched: ContainerId[];
  chaosBefore: number;
  chaosAfter: number;
  beforeStacks: number;
  afterStacks: number;
  beforeTypes: number;
  afterTypes: number;
  /** 全仓容量（整理后） */
  totalSlots: number;
  /** 全仓已用槽位（整理后） */
  usedSlots: number;
  /** 整理后全仓每物品汇总（供 top-N 展示） */
  perType: Record<ItemId, OrganizeTypeStat>;
}

export class OrganizeService {
  constructor(
    private readonly organizer: Organizer,
    private readonly bus: EventBus
  ) {}

  /** 执行整理：analyze + apply；返回详细结果并对涉及容器发 container-changed（不重建索引） */
  organize(warehouse: Warehouse, journal: MoveJournal): OrganizeResult {
    const plan = this.organizer.analyze(warehouse);
    const touched = [...new Set(plan.actions.flatMap((a) => [a.from, a.to]))];
    if (plan.actions.length === 0) {
      return {
        ok: true,
        moves: 0,
        skipped: 0,
        actionsPlanned: 0,
        touched,
        chaosBefore: plan.chaosBefore,
        chaosAfter: plan.chaosAfter,
        beforeStacks: 0,
        afterStacks: 0,
        beforeTypes: 0,
        afterTypes: 0,
        totalSlots: 0,
        usedSlots: 0,
        perType: {},
      };
    }
    const before = this.summarize(warehouse);
    const result = this.organizer.apply(warehouse, plan, journal);
    if (!result.ok) {
      return {
        ok: false,
        moves: 0,
        skipped: 0,
        actionsPlanned: plan.actions.length,
        touched,
        chaosBefore: plan.chaosBefore,
        chaosAfter: plan.chaosAfter,
        beforeStacks: before.stacks,
        afterStacks: before.stacks,
        beforeTypes: before.types,
        afterTypes: before.types,
        totalSlots: before.totalSlots,
        usedSlots: before.usedSlots,
        perType: before.perType,
      };
    }
    const after = this.summarize(warehouse);
    this.bus.organizeCompleted.trigger({ type: "organize-completed", warehouseId: warehouse.id, moves: result.moved });
    for (const id of touched) {
      // 整理改变了容器内容 → 对外发 container-changed（统计失效/成员通知的观察信号）
      this.bus.containerChanged.trigger({ type: "container-changed", warehouseId: warehouse.id, containerId: id });
    }
    return {
      ok: true,
      moves: result.moved,
      skipped: result.skipped,
      actionsPlanned: plan.actions.length,
      touched,
      chaosBefore: plan.chaosBefore,
      chaosAfter: plan.chaosAfter,
      beforeStacks: before.stacks,
      afterStacks: after.stacks,
      beforeTypes: before.types,
      afterTypes: after.types,
      totalSlots: after.totalSlots,
      usedSlots: after.usedSlots,
      perType: after.perType,
    };
  }

  /** 全仓汇总（整理前后各扫一遍，仅手动整理低频路径使用） */
  private summarize(warehouse: Warehouse): {
    stacks: number;
    types: number;
    usedSlots: number;
    totalSlots: number;
    perType: Record<ItemId, OrganizeTypeStat>;
  } {
    const perType: Record<ItemId, OrganizeTypeStat> = {};
    let stacks = 0;
    let usedSlots = 0;
    let totalSlots = 0;
    for (const container of warehouse.containers.values()) {
      totalSlots += container.capacity;
      for (let i = 0; i < container.capacity; i++) {
        const item = container.getItem(i);
        if (item === undefined) continue;
        stacks++;
        usedSlots++;
        const stat = perType[item.itemId] ?? { stacks: 0, total: 0 };
        stat.stacks++;
        stat.total += item.amount;
        perType[item.itemId] = stat;
      }
    }
    return { stacks, types: Object.keys(perType).length, usedSlots, totalSlots, perType };
  }
}
