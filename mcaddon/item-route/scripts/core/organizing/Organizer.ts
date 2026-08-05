// ─── 概念化整理器：混乱度评分 + analyze/apply + 事务回滚 ──
// 三段式（v1 smartwarehouse SlotOrganizer 思路的简化版）：
//   analyze （只读） ：算出"把哪些槽位的物品挪到哪个容器"的整理计划 + 混乱度前后对比
//   apply   （写入） ：逐 action 用 transfer 原子移动（MoveJournal 包事务）
// 设计要点（审查）：
//   · 混乱度采用 v1 smartwarehouse 模型：总分 0-1 加权 = 顺序逆序对(70%) + 未满堆叠(30%)。
//     顺序分：非空序列相邻逆序对占比（一个错位只影响相邻，不级联拉满）；
//     堆叠分：同种物品 ≥2 组未满堆叠才计未优化。非空槽 ≤1 时总分 0（纯净）。
//     shouldAutoSort 用 `> threshold`（threshold 为 0-1），与 v1 onDeposit 语义一致。
//     混乱度与统计共享 `scanContainer` 单趟扫描（messinessFromScan 吃扫描结果）。
//   · 多物容器间合并用 **id 升序单方向**（container.id < picked.id 才发动作），
//     避免 a→b 与 b→a 互逆死锁（见 analyzing 里 multi 分支）。
//   · apply 三态语义：目标失效/异常 → 整体回滚 { ok:false }；**未移动（满/不同 NBT 不可堆叠）
//     → 跳过该动作继续**（不因一个不可堆叠对让整次整理失败），并计数 moved/skipped。
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId } from "../model/types";
import { scanContainer, type ContainerScanResult } from "../model/ContainerScan";
import type { CandidateSorter } from "../routing/CandidateSorter";
import type { CandidateContainer } from "../routing/RouteStrategy";
import { transfer, type MoveJournal } from "../routing/Move";

export interface OrganizeAction {
  from: ContainerId;
  fromSlot: number;
  to: ContainerId;
}

export interface OrganizePlan {
  actions: OrganizeAction[];
  chaosBefore: number;
  chaosAfter: number;
}

/** apply 执行结果：整体成败 + 移动/跳过计数（供手动整理输出明细） */
export interface ApplyResult {
  ok: boolean;
  /** 实际发生移动的堆数 */
  moved: number;
  /** 未移动（目标满/不可堆叠）而跳过的动作数 */
  skipped: number;
}

/** 混乱度评分分解（v1 smartwarehouse MessinessScore） */
export interface MessinessScore {
  /** 总分 0-1，越高越乱 */
  total: number;
  /** 顺序评分（权重 70%）：相邻逆序对占比 */
  order: number;
  /** 堆叠评分（权重 30%）：未充分堆叠占比 */
  stack: number;
  /** 最后一个非空槽索引 + 1（排序用分母） */
  effectiveSlots: number;
  /** 相邻逆序对数 */
  disorderSlots: number;
  /** 非空槽位数 */
  nonEmptySlots: number;
  /** 未优化（同种 ≥2 组未满堆叠）的堆叠数 */
  suboptimalStacks: number;
}

export class Organizer {
  constructor(private readonly sorter: CandidateSorter) {}

  /**
   * 容器混乱度（v1 smartwarehouse 模型，总分 0-1）。
   * - 顺序分（70%）：非空物品序列的相邻逆序对占比——只统计相邻关系，不级联。
   * - 堆叠分（30%）：同种物品有 2 组及以上未满堆叠才记入未优化（1 组未满属正常使用）。
   */
  messiness(container: Container): MessinessScore {
    return this.messinessFromScan(scanContainer(container));
  }

  /**
   * 基于扫描结果计算混乱度——与统计维护（StatsService.updateFromScan）共享同一趟
   * scanContainer 扫描，避免各消费方各自遍历容器（路由成功后"混乱度检查 + 统计"用）。
   */
  messinessFromScan(scan: ContainerScanResult): MessinessScore {
    const items = scan.items;
    const nonEmptySlots = items.length;
    const effectiveSlots = scan.lastNonEmptySlot >= 0 ? scan.lastNonEmptySlot + 1 : 0;
    if (nonEmptySlots <= 1) {
      return { total: 0, order: 0, stack: 0, effectiveSlots, disorderSlots: 0, nonEmptySlots, suboptimalStacks: 0 };
    }
    // 顺序评分（70%）——相邻逆序对，一个错位只影响相邻关系，不级联拉满
    // 例：[A,C,B,D] → 仅 C>B 一对逆序 → 1/3 × 0.7 = 0.23
    let inversions = 0;
    for (let i = 0; i < items.length - 1; i++) {
      if (items[i]!.itemId.localeCompare(items[i + 1]!.itemId) > 0) inversions++;
    }
    const maxInversions = Math.max(1, items.length - 1);
    const order = (inversions / maxInversions) * 0.7;
    // 堆叠评分（30%）——同种 ≥2 组未满堆叠记入未优化
    const groups = new Map<ItemId, { stacks: number; nonFull: number }>();
    for (const item of items) {
      const g = groups.get(item.itemId) ?? { stacks: 0, nonFull: 0 };
      g.stacks++;
      if (item.amount < item.maxStackSize) g.nonFull++;
      groups.set(item.itemId, g);
    }
    let suboptimalStacks = 0;
    for (const g of groups.values()) {
      if (g.nonFull >= 2) suboptimalStacks += g.nonFull;
    }
    const stack = nonEmptySlots > 0 ? (suboptimalStacks / nonEmptySlots) * 0.3 : 0;
    const total = Math.min(1, order + stack);
    return { total, order, stack, effectiveSlots, disorderSlots: inversions, nonEmptySlots, suboptimalStacks };
  }

  /** 容器混乱度总分 0-1（v1 模型），供自动整理阈值判定 */
  chaosScore(container: Container): number {
    return this.messiness(container).total;
  }

  shouldAutoSort(container: Container, threshold: number): boolean {
    return this.chaosScore(container) > threshold;
  }

  /** 基于扫描结果直接判定是否需自动整理（免二次扫描） */
  shouldAutoSortFromScan(scan: ContainerScanResult, threshold: number): boolean {
    return this.messinessFromScan(scan).total > threshold;
  }

  /** 生成整理计划：杂项归入同类型多物/单物容器；多物容器间合并 */
  analyze(warehouse: Warehouse): OrganizePlan {
    const actions: OrganizeAction[] = [];
    const multisByItem = new Map<ItemId, Container[]>();
    const singlesByItem = new Map<ItemId, Container>();
    for (const container of warehouse.containers.values()) {
      if (container.role === "multi") {
        for (let i = 0; i < container.capacity; i++) {
          const item = container.getItem(i);
          if (item === undefined) continue;
          const list = multisByItem.get(item.itemId) ?? [];
          if (!list.includes(container)) list.push(container);
          multisByItem.set(item.itemId, list);
        }
      } else if (container.role === "single") {
        const binding = container.getDedicatedItemId();
        if (binding !== undefined) singlesByItem.set(binding, container);
      }
    }
    const pickMultiTarget = (itemId: ItemId, exclude?: Container): Container | undefined => {
      const list = (multisByItem.get(itemId) ?? []).filter((c) => c !== exclude && c.emptySlotsCount > 0);
      if (list.length === 0) return undefined;
      const candidates: CandidateContainer[] = list.map((c) => ({
        container: c,
        priority: c.priority,
        usageRatio: c.capacity > 0 ? c.usedSlots / c.capacity : 1,
        isFull: c.emptySlotsCount === 0,
      }));
      return this.sorter.sort(candidates)[0]?.container;
    };
    for (const container of warehouse.containers.values()) {
      if (container.role === "input") continue;
      for (let slot = 0; slot < container.capacity; slot++) {
        const item = container.getItem(slot);
        if (item === undefined) continue;
        let target: Container | undefined;
        if (container.role === "single") {
          // 单物容器内错位物品 → 移走
          if (item.itemId !== container.getDedicatedItemId()) {
            target = pickMultiTarget(item.itemId) ?? this.firstMisc(warehouse, container.id);
          }
        } else if (container.role === "misc") {
          target =
            pickMultiTarget(item.itemId) ??
            (singlesByItem.get(item.itemId)?.emptySlotsCount ?? 0 > 0 ? singlesByItem.get(item.itemId) : undefined);
        } else if (container.role === "multi") {
          // 多物合并：id 升序单方向，避免互逆动作（a→b 与 b→a 同时产生）
          const picked = pickMultiTarget(item.itemId, container);
          if (picked && container.id < picked.id) target = picked;
        }
        if (target !== undefined) {
          actions.push({ from: container.id, fromSlot: slot, to: target.id });
        }
      }
    }
    let chaosBefore = 0;
    for (const container of warehouse.containers.values()) {
      chaosBefore += this.chaosScore(container);
    }
    // chaosAfter 为保守上界估计（每动作至多减少 1 分，夹到 0），仅作趋势展示
    return { actions, chaosBefore, chaosAfter: Math.max(0, chaosBefore - actions.length) };
  }

  /**
   * 执行计划：逐 action 原子移动；目标失效/写入异常 → 整体回滚并返回 { ok:false }。
   * "未移动"（目标满/同 typeId 但 NBT 不可堆叠，如不同名/特殊组件）→ 跳过该动作继续，
   * 不视为失败——源与目标均未变，快照回滚对其是空操作。
   * 返回 moved/skipped 计数（供手动整理输出详细结果）。
   * 调用方在 apply 前创建空 journal。
   */
  apply(warehouse: Warehouse, plan: OrganizePlan, journal: MoveJournal): ApplyResult {
    let moved = 0;
    let skipped = 0;
    for (const action of plan.actions) {
      const from = warehouse.containers.get(action.from);
      const to = warehouse.containers.get(action.to);
      if (!from || !to || !to.enabled) {
        journal.rollback();
        return { ok: false, moved: 0, skipped: 0 };
      }
      const original = from.getItem(action.fromSlot)?.amount ?? 0;
      journal.snapshot(from);
      journal.snapshot(to);
      const remaining = transfer({ container: from, slot: action.fromSlot }, to);
      if (remaining !== undefined && remaining.amount === original) {
        skipped++; // 未移动：跳过（不可堆叠/目标满），源与目标均未被修改
        continue;
      }
      moved++;
    }
    return { ok: true, moved, skipped };
  }

  private firstMisc(warehouse: Warehouse, excludeId: ContainerId): Container | undefined {
    for (const container of warehouse.containers.values()) {
      if (container.id !== excludeId && container.role === "misc" && container.emptySlotsCount > 0) return container;
    }
    return undefined;
  }
}