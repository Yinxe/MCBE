// ─── 策略 4：杂项容器（priority 40，兜底） ──
// 兜底桶：role=misc 且启用的容器全量收（索引不含 misc，直接全量取）。
// 黑白名单：黑名单命中 → Router 准入拒绝；白名单（若有）限定只收声明内（准入拒绝非声明项）。
import type { CandidateContainer, RouteContext, RouteStrategy } from "./RouteStrategy";
import { containerIsLost, toCandidate } from "./helpers";

/** 策略 4：杂项容器（兜底，索引不含 misc——直接全量取） */
export class MiscStrategy implements RouteStrategy {
  readonly key = "misc";
  readonly priority = 40;
  readonly isFallback = true;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const out: CandidateContainer[] = [];
    for (const container of ctx.warehouse.containers.values()) {
      // ⚠️ 失联容器不参与候选（判定/事件已由路由层前置门完成，此处仅按 isLost 谓词排除，绝不再探测）
      if (containerIsLost(container)) continue;
      if (container.role === "misc" && container.enabled) {
        out.push(toCandidate(container));
      }
    }
    return out;
  }
}