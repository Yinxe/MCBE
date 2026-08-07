// ─── 路由策略（可插拔，数字优先级越小越快） ────────────────
// 四个内置策略构成 5 级路由的 4 段骨架：
//   SingleItem(10)：候选 = 索引中该 typeId 的单物容器（且绑定匹配）→ 单物优先
//   MultiItem(20) ：候选 = 索引中该 typeId 的多物容器 → 同型聚集
//   Family(30)    ：候选 = 仓库内绑定了 item 所属族的容器（且该族启用）→ 同族收纳
//   Misc(40)      ：兜底，候选 = 全部启用 misc 容器（索引不含 misc，直接全量取）
// 设计要点（审查）：
//   · 候选来自**索引**而非全仓扫描 —— 索引是本模块的性能底座（O(1) 定位）。
//     Family 是唯一例外：族容器按 `container.familyId` 全仓线性取（族容器数量少，可接受；
//     族判定数据驱动 `FAMILY_BY_ITEM`，不必进索引）。其余候选均走索引。
//   · 空 multi 容器不是候选（索引只登记"已含该物品"的容器）—— 见 ItemIndex。
//   · 惰性校验为**策略自持**（不共享一条按 role 分支的索引校验）：SingleItem 查绑定、
//     MultiItem 查该类型槽存在，候选命中时若漂移则调 ctx.reconcile 按真实内容重建索引条目
//     （三层兜底之第二层，见 ItemIndex.reconcile）。
//   · 多物可行判定是**类型级**（同 ID 不同 NBT 视为同类，如命名剑/白板剑同收，各落槽不合并）；
//     写回的 NBT 精确判定由 McContainerAdapter.addItem → mc.addItem 权威裁决（同型不同 NBT
//     不错误堆叠）。这修正了旧实现用 mc.contains（NBT 精确）导致"装了白板剑的多物容器不收
//     命名剑"的口径不一致——见 MultiItemStrategy。
//   · 容器级黑白名单是**通用准入**（Router.attempt 在转移前统一校验，见 containerAcceptsItem）：
//     黑名单命中 → 任何层级都不进该容器；白名单非空且不含 → 不进。族路由/多物/单物/兜底一致。
//   · 漏斗在工厂层强制 input，永不进入本路由的目标侧。
import type { Container, ContainerRole } from "../model/Container";
import type { ItemStack } from "../model/ItemStack";
import type { Warehouse } from "../model/Warehouse";
import { isFamilyEnabled } from "../model/Warehouse";
import { familyOf } from "../data/item-families";
import type { ContainerId, ItemId } from "../model/types";

/**
 * 容器通用准入判定（黑白名单）：黑名单命中 itemId → 永不进入；
 * 白名单非空且不含 itemId → 也不进入。Router.attempt 在 transfer 前统一调用。
 */
export function containerAcceptsItem(container: Container, itemId: ItemId): boolean {
  if (container.blacklist.includes(itemId)) return false;
  if (container.whitelist.length > 0 && !container.whitelist.includes(itemId)) return false;
  return true;
}

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
  /** 是否兜底策略（misc）：Router 在真实策略无有效候选、自愈重扫后仍无果时才执行 */
  readonly isFallback?: boolean;
  findCandidates(ctx: RouteContext): CandidateContainer[];
}

/**
 * 白名单声明式候选：扫描仓库内 `whitelist` 含该物品、角色相符的容器 → 加入候选。
 * **语义**：白名单 = 允许（声明式）收纳，即使容器当前没装该物品/空箱也能收（预分配）。
 * 与索引候选去重（seen）。白名单容器少，线性扫全仓成本可忽略。
 */
function collectWhitelisted(
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

/** 策略 1：单物容器 —— 绑定匹配（索引）或 白名单声明（允许缺物）。单物同样支持黑白名单 */
export class SingleItemStrategy implements RouteStrategy {
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
    collectWhitelisted(ctx, itemId, ["single"], seen, out);
    return out;
  }
}

/** 容器是否已存在给定**类型**的槽（typeId 级，非 NBT 精确——多物候选判定用） */
function hasItemType(container: Container, itemId: ItemId): boolean {
  for (let i = 0; i < container.capacity; i++) {
    if (container.getItem(i)?.itemId === itemId) return true;
  }
  return false;
}

/** 容器是否已含某族的任一成员（typeId → familyOf 精确判断，族路由惰性校验用） */
function containerHasFamilyMember(container: Container, familyId: string): boolean {
  for (let i = 0; i < container.capacity; i++) {
    const id = container.getItem(i)?.itemId;
    if (id !== undefined && familyOf(id) === familyId) return true;
  }
  return false;
}

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
    collectWhitelisted(ctx, itemId, ["multi"], seen, out);
    return out;
  }
}

/** 策略 3：同族路由。物品所属族启用，且启族多物容器**实含该族任一成员**（或白名单声明）→ 收族内任意物品 */
export class FamilyStrategy implements RouteStrategy {
  readonly priority = 30;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const itemId = ctx.item.itemId;
    const familyId = familyOf(itemId);
    if (familyId === undefined) return []; // 物品不在任何族 → 无族候选
    if (!isFamilyEnabled(ctx.warehouse.settings, familyId)) return []; // 该族被仓库禁用 → 跳过
    const seen = new Set<ContainerId>();
    const out: CandidateContainer[] = [];
    // ① 族桶候选：复用多物索引派生的族桶，O(1) 定位装了该族成员的启族容器（存白羊毛即羊毛桶）
    for (const id of ctx.lookupFamily(familyId)) {
      const container = ctx.warehouse.containers.get(id);
      if (!container || !container.enabled || container.role !== "multi" || seen.has(id)) continue;
      if (container.whitelist.includes(itemId)) {
        seen.add(id);
        out.push(toCandidate(container));
        continue;
      }
      // 惰性校验：容器须仍实含该族成员（索引漂移 → 重建移除或修复）
      if (container.familyEnabled && containerHasFamilyMember(container, familyId)) {
        seen.add(id);
        out.push(toCandidate(container));
      } else {
        ctx.reconcile(container);
      }
    }
    // ② 白名单声明式：空族容器被白名单"预订"某族物品 → 也能收（缺物允许）
    for (const c of ctx.warehouse.containers.values()) {
      if (c.role !== "multi" || !c.familyEnabled || !c.enabled) continue;
      if (seen.has(c.id) || !c.whitelist.includes(itemId)) continue;
      seen.add(c.id);
      out.push(toCandidate(c));
    }
    return out;
  }
}

/** 策略 4：杂项容器（兜底，索引不含 misc——直接全量取） */
export class MiscStrategy implements RouteStrategy {
  readonly priority = 40;
  readonly isFallback = true;

  findCandidates(ctx: RouteContext): CandidateContainer[] {
    const out: CandidateContainer[] = [];
    for (const container of ctx.warehouse.containers.values()) {
      if (container.role === "misc" && container.enabled) {
        out.push(toCandidate(container));
      }
    }
    return out;
  }
}

function toCandidate(container: Container): CandidateContainer {
  const ratio = container.capacity > 0 ? container.usedSlots / container.capacity : 1;
  return {
    container,
    priority: container.priority,
    usageRatio: ratio,
    isFull: container.emptySlotsCount === 0,
  };
}
