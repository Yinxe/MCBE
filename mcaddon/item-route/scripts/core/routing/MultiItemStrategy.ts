// ─── 策略 2：多物容器（priority 20） ──
// 候选 = 索引中该 typeId 的多物容器（同型聚集，内容派生）+ 白名单声明式（允许缺物）。
// 类型级判定（同 ID 不同 NBT 视为同类，各落槽不合并，由 mc.addItem 权威裁决）。
import type { ContainerId } from "../model/types";
import type { CandidateContainer, RouteContext, RouteStrategy } from "./RouteStrategy";
import { collectWhitelistedCandidates } from "./Admission";
import { hasItemType, toCandidate } from "./helpers";

/** 策略 2：多物容器 —— 同型聚集（实含该类型）或 白名单声明（缺物也能收） */
export class MultiItemStrategy implements RouteStrategy {
  readonly priority = 20;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const itemId = ctx.item.itemId;
    const seen = new Set<ContainerId>();
    const out: CandidateContainer[] = [];
    for (const id of ctx.lookupIndex(itemId).multi) {
      const container = ctx.warehouse.containers.get(id);
      if (!container || container.role !== "multi") continue;
      // 白名单声明命中 → 缺物也是候选（不 reconcile）；否则须实含该类型，仍漂移才重建
      if (container.whitelist.includes(itemId)) {
        seen.add(id);
        out.push(toCandidate(container));
        continue;
      }
      // 类型级可行：只要容器已含该 typeId（不管 NBT 变不变体）即收；异 NBT 各落槽不合并，
      // 由 mc.addItem 权威裁决（详见文件头）。索引漂移（索引说含、实际已无该类型）→重建移除候选。
      if (hasItemType(container, itemId)) {
        seen.add(id);
        out.push(toCandidate(container));
      } else {
        ctx.reconcile(container);
      }
    }
    collectWhitelistedCandidates(ctx, itemId, ["multi"], seen, out);
    return out;
  }
}