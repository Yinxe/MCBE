// ─── 候选排序器（可插拔，默认实现） ──────────────────────
import type { CandidateContainer } from "./RouteStrategy";

/** 候选排序器：满箱跳过 → priority 升序 → usageRatio 降序（更满的优先，减少空耗往返） */
export interface CandidateSorter {
  sort(candidates: CandidateContainer[]): CandidateContainer[];
}

/** 默认实现：过滤满箱后，按 priority 升序（数字小先），同 priority 按已用占比降序 */
export class DefaultCandidateSorter implements CandidateSorter {
  sort(candidates: CandidateContainer[]): CandidateContainer[] {
    return candidates
      .filter((c) => !c.isFull)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.usageRatio - a.usageRatio; // 更满的先
      });
  }
}
