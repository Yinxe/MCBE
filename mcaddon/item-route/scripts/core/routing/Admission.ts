// ─── 黑白名单横切层（准入裁决 + 白名单声明候选） ──
// 目标：黑白名单逻辑**不耦合进各策略**。策略只产出"内容派生的候选"，黑白名单在此收敛：
//   · `containerAcceptsItem` —— 准入裁决（Router.attempt 在 transfer 前统一调用）：
//         **黑名单命中 itemId → 永不进入该容器**（覆盖索引/族桶的一切候选）。
//         ⚠️ 白名单不在准入里做减法：白名单 = "允许"（加法），非"限定"——即使容器没装该物
//         也能进（见 collectWhitelistedCandidates）；实装的其他类型也照常收（不收紧）。
//   · `collectWhitelistedCandidates` —— 白名单**声明式**候选源：容器白名单含该物品即成为候选，
//         即使容器当前空箱/没装该物品（允许式预分配）。策略各调一行，此处统一实现。
// 语义锚点：黑名单 = 拒绝（永远不入）；白名单 = 允许（声明式，缺物也能进）。
import type { Container, ContainerRole } from "../model/Container";
import type { ContainerId, ItemId } from "../model/types";
import type { CandidateContainer, RouteContext } from "./RouteStrategy";
import { toCandidate } from "./helpers";

/**
 * 容器通用准入（仅黑名单拒绝）。
 * 黑名单命中 → 该容器永远不收此物品；白名单是"允许"非"限定"，不在此拒绝（见 collectWhitelistedCandidates）。
 * Router.attempt 对每个候选统一调用，先于 transfer —— 覆盖单物/多物/同族/杂项所有层级。
 */
export function containerAcceptsItem(container: Container, itemId: ItemId): boolean {
  return !container.blacklist.includes(itemId);
}

/**
 * 白名单声明式候选：扫描仓库内 `whitelist` 含该物品、角色相符的容器 → 加入候选。
 * **语义**：白名单 = 允许（声明式）收纳，即使容器当前没装该物品/空箱也能收（预分配分类）。
 * 匹配到的容器与索引候选去重（seen）。因白名单容器少，线性扫全仓成本可忽略。
 * 由各策略调用（单物/多物/同族各传自己的角色集），黑白名单实现集中在本模块。
 */
export function collectWhitelistedCandidates(
  ctx: RouteContext,
  itemId: ItemId,
  roles: ReadonlyArray<ContainerRole>,
  seen: Set<ContainerId>,
  out: CandidateContainer[]
): void {
  for (const c of ctx.warehouse.containers.values()) {
    if (!c.enabled || !roles.includes(c.role)) continue;
    if (!c.whitelist.includes(itemId) || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(toCandidate(c));
  }
}