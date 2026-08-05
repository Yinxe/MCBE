// ─── 路由编排：单槽路由，策略升序 + 候选排序 + 原子移动 ──
// 每轮处理**一个输入容器的非空 slot**（由 Scheduler 驱动，见 processOnce）。
// 流程：策略按 priority 升序（single→multi→misc）逐个找候选 → 候选经排序器
// （满箱跳过/优先级/使用率）→ 逐个尝试 transfer，第一个发生移动即返回。
// 关键设计：
//   · 依赖注入 IndexGateway（结构类型）而非直接引 ItemIndex —— 隔离 index 模块，
//     可单测用 stub 替身（tests/routing.test.ts 的 makeIndexStub）。
//   · 全部候选失败返回 undefined，物品留在源 —— 单槽原子性，不产生半成品。
import { transfer } from "./Move";
import type { CandidateContainer, RouteStrategy } from "./RouteStrategy";
import type { CandidateSorter } from "./CandidateSorter";
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId } from "../model/types";
import type { EventBus } from "../events/DomainEvents";

/** 索引能力接口（结构类型，Router 不依赖 index 模块） */
export interface IndexGateway {
  lookup(typeId: ItemId): { single: ContainerId[]; multi: ContainerId[] };
  verifyCandidate(container: Container): boolean;
  onItemMoved(from: ContainerId, to: ContainerId, itemId: ItemId): void;
}

export interface RouteResult {
  routed: true;
  from: ContainerId;
  to: ContainerId;
  itemId: ItemId;
  amount: number;
}

export class Router {
  constructor(
    private readonly strategies: RouteStrategy[],
    private readonly sorter: CandidateSorter,
    private readonly index: IndexGateway,
    private readonly bus: EventBus
  ) {}

  /**
   * 处理一个输入容器的非空 slot。
   * 按策略 priority 升序执行，策略内候选经排序后逐个尝试转移；
   * 第一个发生移动即返回结果；全部失败返回 undefined（物品留在源）。
   */
  routeFrom(input: Container, slot: number, warehouse: Warehouse): RouteResult | undefined {
    const stack = input.getItem(slot);
    if (stack === undefined) return undefined;
    const originalAmount = stack.amount;
    const ctx = {
      item: stack,
      warehouse,
      lookupIndex: (typeId: ItemId) => this.index.lookup(typeId),
      verifyCandidate: (c: Container) => this.index.verifyCandidate(c),
    };
    const ordered = [...this.strategies].sort((a, b) => a.priority - b.priority);
    for (const strategy of ordered) {
      const raw = strategy.findCandidates(ctx);
      const candidates = this.sorter.sort(raw);
      for (const candidate of candidates) {
        const target = candidate.container;
        if (!target.enabled) continue;
        const remaining = transfer({ container: input, slot }, target);
        if (remaining !== undefined && remaining.amount === originalAmount) continue; // 未移动
        const moved = originalAmount - (remaining?.amount ?? 0);
        this.index.onItemMoved(input.id, target.id, stack.itemId);
        this.bus.itemRouted.trigger({
          type: "item-routed",
          warehouseId: warehouse.id,
          from: input.id,
          to: target.id,
          itemId: stack.itemId,
          amount: moved,
        });
        return { routed: true, from: input.id, to: target.id, itemId: stack.itemId, amount: moved };
      }
    }
    return undefined;
  }
}