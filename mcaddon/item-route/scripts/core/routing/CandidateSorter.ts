// ─── 候选排序器（可插拔，默认实现） ──────────────────────
import type { CandidateContainer } from "./RouteStrategy";

/** 候选排序器：满箱跳过 → priority 升序 → usageRatio 降序 */
export interface CandidateSorter {
  sort(candidates: CandidateContainer[]): CandidateContainer[];
}

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