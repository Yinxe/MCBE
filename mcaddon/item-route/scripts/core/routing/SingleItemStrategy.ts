// ─── 策略 1：单物容器（priority 10） ──
// 候选 = 索引中该 typeId 的单物容器（绑定匹配，内容派生）+ 白名单声明式（允许缺物）。
// 单物同样受黑白名单约束（黑名单准入拦截在 Router.attempt 统一经 admission.accepts 裁决）。
import type { ContainerId } from "../model/types";
import type { CandidateContainer, RouteContext, RouteStrategy } from "./RouteStrategy";
import { toCandidate } from "./helpers";

/** 策略 1：单物容器 —— 绑定匹配（索引）或 白名单声明（允许缺物）。单物同样支持黑白名单 */
export class SingleItemStrategy implements RouteStrategy {
  readonly key = "single";
  readonly priority = 10;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const itemId = ctx.item.itemId;
    const seen = new Set<ContainerId>();
    const out: CandidateContainer[] = [];
    // ① 索引候选：绑定匹配该类型（内容派生）
    for (const id of ctx.lookupIndex(itemId).single) {
      const container = ctx.warehouse.containers.get(id);
      if (!container || container.role !== "single") continue;
      if (container.getDedicatedItemId() !== itemId) {
        // 单物绑定漂移/空箱 → 按真实内容重建条目（修复绑定或移除过期），再复查
        ctx.reconcile(container);
      }
      if (container.getDedicatedItemId() === itemId && !seen.has(id)) {
        seen.add(id);
        out.push(toCandidate(container));
      }
    }
    // ② 白名单声明式：空单物被白名单"预订"（缺物也能收），实现单物预分配
    ctx.admission.collectWhitelisted(ctx, itemId, ["single"], seen, out);
    return out;
  }
}