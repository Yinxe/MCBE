// ─── 概念化整理器：混乱度评分 + analyze/apply/回滚 + 自动阈值 ──
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId } from "../model/types";
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

export class Organizer {
  constructor(private readonly sorter: CandidateSorter) {}

  /** 混乱度 = 混合类型数 - 1（0 = 纯净容器） */
  chaosScore(container: Container): number {
    const types = new Set<ItemId>();
    for (let i = 0; i < container.capacity; i++) {
      const item = container.getItem(i);
      if (item !== undefined) types.add(item.itemId);
    }
    return Math.max(0, types.size - 1);
  }

  shouldAutoSort(container: Container, threshold: number): boolean {
    return this.chaosScore(container) > threshold;
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
    return { actions, chaosBefore, chaosAfter: Math.max(0, chaosBefore - actions.length) };
  }

  /**
   * 执行计划：逐 action 原子移动；目标失效/写入异常 → 整体回滚并返回 false。
   * "未移动"（目标满/同 typeId 但 NBT 不可堆叠，如不同名/特殊组件）→ 跳过该动作继续，
   * 不视为失败——源与目标均未变，快照回滚对其是空操作。
   * 调用方在 apply 前创建空 journal。
   */
  apply(warehouse: Warehouse, plan: OrganizePlan, journal: MoveJournal): boolean {
    for (const action of plan.actions) {
      const from = warehouse.containers.get(action.from);
      const to = warehouse.containers.get(action.to);
      if (!from || !to || !to.enabled) {
        journal.rollback();
        return false;
      }
      const original = from.getItem(action.fromSlot)?.amount ?? 0;
      journal.snapshot(from);
      journal.snapshot(to);
      const remaining = transfer({ container: from, slot: action.fromSlot }, to);
      if (remaining !== undefined && remaining.amount === original) {
        // 未移动：跳过（不可堆叠/目标满），源与目标均未被修改
        continue;
      }
    }
    return true;
  }

  private firstMisc(warehouse: Warehouse, excludeId: ContainerId): Container | undefined {
    for (const container of warehouse.containers.values()) {
      if (container.id !== excludeId && container.role === "misc" && container.emptySlotsCount > 0) return container;
    }
    return undefined;
  }
}