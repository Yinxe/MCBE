// ─── 路由策略（可插拔，数字优先级越小越快） ────────────────
// 三个内置策略构成 5 级路由的 3 段骨架：
//   SingleItem(10)：候选 = 索引中该 typeId 的单物容器（且绑定匹配）→ 单物优先
//   MultiItem(20) ：候选 = 索引中该 typeId 的多物容器 → 同型聚集
//   Misc(30)      ：兜底，候选 = 全部启用 misc 容器（索引不含 misc，直接全量取）
// 设计要点（审查）：
//   · 候选来自**索引**而非全仓扫描 —— 索引是本模块的性能底座（O(1) 定位）。
//   · 空 multi 容器不是候选（索引只登记"已含该物品"的容器）—— 见 ItemIndex。
//   · 惰性校验为**策略自持**（不共享一条按 role 分支的索引校验）：SingleItem 查绑定、
//     MultiItem 查 contains，候选命中时若漂移则调 ctx.reconcile 按真实内容重建索引条目
//     （三层兜底之第二层，见 ItemIndex.reconcile）。
//   · 漏斗在工厂层强制 input，永不进入本路由的目标侧。
import type { Container } from "../model/Container";
import type { ItemStack } from "../model/ItemStack";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId } from "../model/types";

/** 索引查询结果（由 Router 注入，避免 routing 依赖 index 模块） */
export interface IndexLookupResult {
  single: ContainerId[];
  multi: ContainerId[];
}

/** 路由上下文：物品 + 仓库 + 索引查询/校验能力（函数注入） */
export interface RouteContext {
  item: ItemStack;
  warehouse: Warehouse;
  lookupIndex(typeId: ItemId): IndexLookupResult;
  /** 候选漂移时按容器真实内容重建索引条目（策略自行校验后调用，修复/移除过期候选） */
  reconcile(container: Container): void;
}

/** 候选容器（含排序所需信息） */
export interface CandidateContainer {
  container: Container;
  priority: number;
  usageRatio: number;
  isFull: boolean;
}

/** 路由策略：按数字优先级升序执行 */
export interface RouteStrategy {
  readonly priority: number;
  findCandidates(ctx: RouteContext): CandidateContainer[];
}

/** 策略 1：单物容器（绑定匹配） */
export class SingleItemStrategy implements RouteStrategy {
  readonly priority = 10;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const ids = ctx.lookupIndex(ctx.item.itemId).single;
    const out: CandidateContainer[] = [];
    for (const id of ids) {
      const container = ctx.warehouse.containers.get(id);
      if (!container || container.role !== "single") continue;
      if (container.getDedicatedItemId() !== ctx.item.itemId) {
        // 单物绑定漂移/空箱 → 按真实内容重建条目（修复绑定或移除过期），再复查
        ctx.reconcile(container);
      }
      if (container.getDedicatedItemId() === ctx.item.itemId) out.push(toCandidate(container));
    }
    return out;
  }
}

/** 策略 2：多物容器 */
export class MultiItemStrategy implements RouteStrategy {
  readonly priority = 20;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const ids = ctx.lookupIndex(ctx.item.itemId).multi;
    const out: CandidateContainer[] = [];
    for (const id of ids) {
      const container = ctx.warehouse.containers.get(id);
      if (!container || container.role !== "multi") continue;
      if (!container.contains(ctx.item)) {
        // 索引漂移：容器已不含该类型（被清/换走）→ 重建条目移除过期候选，再复查
        ctx.reconcile(container);
      }
      if (container.contains(ctx.item)) out.push(toCandidate(container));
    }
    return out;
  }
}

/** 策略 3：杂项容器（兜底，索引不含 misc——直接全量取） */
export class MiscStrategy implements RouteStrategy {
  readonly priority = 30;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const out: CandidateContainer[] = [];
    for (const container of ctx.warehouse.containers.values()) {
      if (container.role === "misc" && container.enabled) {
        out.push(toCandidate(container));
      }
    }
    return out;
  }
}

function toCandidate(container: Container): CandidateContainer {
  const ratio = container.capacity > 0 ? container.usedSlots / container.capacity : 1;
  return {
    container,
    priority: container.priority,
    usageRatio: ratio,
    isFull: container.emptySlotsCount === 0,
  };
}