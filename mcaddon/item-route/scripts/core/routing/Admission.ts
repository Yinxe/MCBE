// ─── 黑白名单拦截器（准入裁决 + 白名单声明候选，单一封装） ──
// 设计（同类有"织入"诉求）：
//   · 黑名单 = **拦截器**（reject）：命中 itemId 的容器候选在路由前被 try/catch 式拦截，
//     永不进入该容器 —— 覆盖单物/多物/同族/杂项一切层级（前置于策略候选的排序/转移）。
//   · 白名单 = **允许（加法）**：声明式候选源，即使容器当前缺物/空箱也能进（预分配）。
//     白名单**不在准入做减法**（不收紧实装类型）——只经 `collectWhitelisted` 产出候选。
//   - 二者封装进一个 `AdmissionInterceptor` 实例，随 Router 注入各策略（ctx.admission），
//     不再导出游离函数 —— 实现统一入口、可组合、可测试。
import type { Container, ContainerRole } from "../model/Container";
import type { ContainerId, ItemId } from "../model/types";
import type { CandidateContainer, RouteContext } from "./RouteStrategy";
import { toCandidate } from "./helpers";

/** 白名单声明收集回调签名（供策略内一行调用） */
export type WhitelistCollector = (
  ctx: RouteContext,
  itemId: ItemId,
  roles: ReadonlyArray<ContainerRole>,
  seen: Set<ContainerId>,
  out: CandidateContainer[]
) => void;

/** 准入拦截器（黑名单）签名：允许=可收，拒绝=永不进入 */
export type AdmissionVeto = (container: Container, itemId: ItemId) => boolean;

/**
 * 黑白名单拦截器：把"拒绝黑名单"与"白名单声明候选"织入路由的单一对象。
 * 黑名单短路优先（拦截语义），白名单只补声明候选（允许语义，非限定）。
 * Router 构造注入本实例（默认单例 `admission`），并下放到 ctx.admission 供策略调用，
 * 替代原先散落的 `containerAcceptsItem` / `collectWhitelistedCandidates` 自由函数。
 */
export class AdmissionInterceptor {
  /** 约定：可注入的容器接收回调（默认实现 = 黑名单拦截；测试可替换/断言调用次数） */
  constructor(private readonly policy: AdmissionVeto = defaultAdmissionVeto) {}

  /** 准入裁决：黑名单命中 → 拒绝（默认 policy）；策略/ Router 在转移前统一调用 */
  accepts(container: Container, itemId: ItemId): boolean {
    return this.policy(container, itemId);
  }

  /** 白名单声明式候选：whitelist 含该物品、角色相符 → 加入候选（缺物也能进） */
  collectWhitelisted: WhitelistCollector = (ctx, itemId, roles, seen, out) => {
    for (const c of ctx.warehouse.containers.values()) {
      if (!c.enabled || !roles.includes(c.role)) continue;
      if (!(c.whitelist ?? []).includes(itemId) || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(toCandidate(c));
    }
  };
}

/** 默认黑名单拦截策略：黑名单命中即拒；缺字段防御旧数据（?? []） */
function defaultAdmissionVeto(container: Container, itemId: ItemId): boolean {
  return !(container.blacklist ?? []).includes(itemId);
}

/** 路由共享单例（Router 默认构造注入；测试可 new AdmissionInterceptor(customPolicy) 独立实例） */
export const admission: AdmissionInterceptor = new AdmissionInterceptor();