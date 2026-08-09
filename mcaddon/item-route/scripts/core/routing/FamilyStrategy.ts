// ─── 策略 3：同族路由（priority 30） ──
// 候选 = 物品所属族的**族桶**（ItemIndex 内容派生的 familyContainers，复用多物索引投影）。
// 多物容器开启"同族收纳"后，实含某族任一成员即入该族桶 → 收纳族内任意物品。
// 白名单声明式（缺物允许）已由多物策略的统一白名单候选覆盖（同 role=multi），本策略无需重复。
import type { ContainerId } from "../model/types";
import type { CandidateContainer, RouteContext, RouteStrategy } from "./RouteStrategy";
import { isFamilyEnabled } from "../model/Warehouse";
import { familyOf } from "../data/item-families";
import { containerHasFamilyMember, toCandidate } from "./helpers";

/** 策略 3：同族路由。物品所属族启用，且启族多物容器**实含该族任一成员**（或白名单声明）→ 收族内任意物品 */
export class FamilyStrategy implements RouteStrategy {
  readonly key = "family";
  readonly priority = 30;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const itemId = ctx.item.itemId;
    const familyId = familyOf(itemId);
    if (familyId === undefined) return []; // 物品不在任何族 → 无族候选
    if (!isFamilyEnabled(ctx.warehouse.settings, familyId)) return []; // 该族被仓库禁用 → 跳过
    const seen = new Set<ContainerId>();
    const out: CandidateContainer[] = [];
    // 族桶候选：复用多物索引派生的族桶，O(1) 定位装了该族成员的启族容器（存白羊毛即羊毛桶）
    for (const id of ctx.lookupFamily(familyId)) {
      const container = ctx.warehouse.containers.get(id);
      if (!container || !container.enabled || container.role !== "multi" || seen.has(id)) continue;
      // 白名单声明式（缺物允许）已由多物策略的统一白名单候选覆盖（同 role=multi）——本策略不重复。
      if (container.familyEnabled && containerHasFamilyMember(container, familyId)) {
        seen.add(id);
        out.push(toCandidate(container));
      } else {
        ctx.reconcile(container);
      }
    }
    return out;
  }
}