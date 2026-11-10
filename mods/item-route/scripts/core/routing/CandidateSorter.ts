// ─── 候选排序器（可插拔，默认实现） ──────────────────────
import type { CandidateContainer } from "./RouteStrategy";

/** 候选排序器：未满优先 → priority 升序 → usageRatio 降序（更满的优先，减少空耗往返） */
export interface CandidateSorter {
  sort(candidates: CandidateContainer[]): CandidateContainer[];
}

/**
 * 默认实现：**满箱不跳过**——满箱容器若含未满堆叠的同类槽，仍可"极限堆叠"部分物品
 * （目标无空槽但可并进现有堆）。排序把未满容器排前（优先找有整格空间的目标），
 * 满箱容器排后（仅作部分堆叠兜底）；同档按 priority 升序、再按已用占比降序。
 */
export class DefaultCandidateSorter implements CandidateSorter {
  sort(candidates: CandidateContainer[]): CandidateContainer[] {
    return [...candidates].sort((a, b) => {
      if (a.isFull !== b.isFull) return a.isFull ? 1 : -1; // 未满优先，满箱靠后（仍可极限堆叠）
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.usageRatio - a.usageRatio; // 更满的先
    });
  }
}
