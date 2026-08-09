// ─── 策略 2：多物容器（priority 20） ──
// 候选 = 索引中该 typeId 的多物容器（同型聚集，内容派生）+ 白名单声明式（允许缺物）。
// 类型级判定（同 ID 不同 NBT 视为同类，各落槽不合并，由 mc.addItem 权威裁决）。
import type { ContainerId } from "../model/types";
import type { CandidateContainer, RouteContext, RouteStrategy } from "./RouteStrategy";
import { hasItemType, toCandidate } from "./helpers";

/** 策略 2：多物容器 —— 同型聚集（实含该类型）或 白名单声明（缺物也能收） */
export class MultiItemStrategy implements RouteStrategy {
  readonly key = "multi";
  readonly priority = 20;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const itemId = ctx.item.itemId;
    const seen = new Set<ContainerId>();
    const out: CandidateContainer[] = [];
    for (const id of ctx.lookupIndex(itemId).multi) {
      const container = ctx.warehouse.containers.get(id);
      if (!container || container.role !== "multi") continue;
      // 实含该类型（不管 NBT 变不变体）即收；异 NBT 各落槽不合并，由 mc.addItem 权威裁决。
      // 索引漂移（索引说含、实际已无该类型）→ 重建移除候选。**白名单声明式候选统一由下方
      // collectWhitelisted 收集（缺物也进）**——不再在此内联，避免与统一收集重复。
      if (hasItemType(container, itemId)) {
        seen.add(id);
        out.push(toCandidate(container));
      } else {
        ctx.reconcile(container);
      }
    }
    ctx.admission.collectWhitelisted(ctx, itemId, ["multi"], seen, out);
    return out;
  }
}
