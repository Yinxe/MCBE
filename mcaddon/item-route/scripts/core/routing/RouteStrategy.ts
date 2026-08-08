// ─── 路由策略（可插拔）：类型定义 + 策略桶导出 ──
// 每种策略独立成文件（Single/Multi/Family/Misc），此文件只承载：路由类型 + 统一 re-export。
// 路线顺序（数字优先级升序）：输入 → 单物(10) → 多物(20) → 同族(30) → 其他(40);
// 黑白名单是**横切层**（Admission.ts，随 Router 注入 ctx.admission）：
//   · 黑名单 = 拦截器（准入裁决）→ Router.attempt 在 transfer 前统一 `admission.accepts`；
//   · 白名单 = 声明式候选 → 各策略调 `admission.collectWhitelisted` 一行（逻辑在 Admission）。
// 依赖方向：策略/Admission/helpers → 仅 type 引本文件；本文件只 re-export 它们（无值循环）。
import type { Container, ContainerRole } from "../model/Container";
import type { ItemStack } from "../model/ItemStack";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId, ItemId } from "../model/types";

/** 索引查询结果（由 Router 注入，避免 routing 依赖 index 模块） */
export interface IndexLookupResult {
  single: ContainerId[];
  multi: ContainerId[];
}

/** 路由上下文：物品 + 仓库 + 索引查询/校验能力（函数注入） */
export interface RouteContext {
  item: ItemStack;
  warehouse: Warehouse;
  lookupIndex(typeId: ItemId): IndexLookupResult;
  /** 同族候选：familyId → 启族多物容器 ID[]（复用多物索引派生的族桶，见 ItemIndex.lookupFamily） */
  lookupFamily(familyId: string): ContainerId[];
  /** 候选漂移时按容器真实内容重建索引条目（策略自行校验后调用，修复/移除过期候选） */
  reconcile(container: Container): void;
  /** 黑白名单拦截器（Router 注入；策略用它取白名单声明候选） */
  admission: {
    /** 黑名单准入拦截：黑名单命中 → 该容器永不收此物品（前置于一切候选转移） */
    accepts(container: Container, itemId: ItemId): boolean;
    /** 白名单声明式候选收集 */
    collectWhitelisted(
      ctx: RouteContext,
      itemId: ItemId,
      roles: ReadonlyArray<ContainerRole>,
      seen: Set<ContainerId>,
      out: CandidateContainer[]
    ): void;
  };
}

/** 候选容器（含排序所需信息） */
export interface CandidateContainer {
  container: Container;
  priority: number;
  usageRatio: number;
  isFull: boolean;
}

/** 路由策略：按数字优先级升序执行 */
export interface RouteStrategy {
  readonly priority: number;
  /** 策略标识（路由追踪/通知/统计用）：single / multi / family / misc */
  readonly key: string;
  /** 是否兜底策略（misc）：Router 在真实策略无有效候选、自愈重扫后仍无果时才执行 */
  readonly isFallback?: boolean;
  findCandidates(ctx: RouteContext): CandidateContainer[];
}

// ── 策略桶导出（main.ts / 基础测试保持既有导入不变） ──
export { SingleItemStrategy } from "./SingleItemStrategy";
export { MultiItemStrategy } from "./MultiItemStrategy";
export { FamilyStrategy } from "./FamilyStrategy";
export { MiscStrategy } from "./MiscStrategy";
// 黑白名单拦截器：Router 注入 ctx.admission 统一织入（黑=准入拦截，白=声明候选）
export { AdmissionInterceptor, admission } from "./Admission";