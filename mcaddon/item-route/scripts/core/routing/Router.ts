// ─── 路由编排：单槽路由，策略升序 + 候选排序 + 原子移动 ──
// 每轮处理**一个输入容器的非空 slot**（由 Scheduler 驱动，见 processOnce）。
// 流程：策略按 priority 升序（single→multi→misc）逐个找候选 → 候选经排序器
// （满箱跳过/优先级/使用率）→ 逐个尝试 transfer，第一个发生移动即返回。
// 关键设计：
//   · 依赖注入 IndexGateway（结构类型）而非直接引 ItemIndex —— 隔离 index 模块，
//     可单测用 stub 替身；且索引按**每次路由调用**传入（而非 Router 持有全局单例），
//     支撑"每仓库独立索引、激活加载/空闲卸载"的隔离（见 Scheduler 的 processOnce）。
//   · 全部候选失败返回 undefined，物品留在源 —— 单槽原子性，不产生半成品。
import { transfer } from "./Move";
import type { CandidateContainer, RouteStrategy } from "./RouteStrategy";
import type { CandidateSorter } from "./CandidateSorter";
import type { Container } from "../model/Container";
import type { Warehouse } from "../model/Warehouse";
import type { ItemStack } from "../model/ItemStack";
import type { ContainerId, ItemId } from "../model/types";
import type { EventBus } from "../events/DomainEvents";

/** selfHeal 冷却时长（墙钟 ms）：同 type 在窗口内不再全仓自愈；配合滑动续期，持续无效流只扫首次。 */
export const SELF_HEAL_COOLDOWN_MS = 5000;

/** 索引能力接口（结构类型，Router 不依赖 index 模块） */
export interface IndexGateway {
  lookup(typeId: ItemId): { single: ContainerId[]; multi: ContainerId[] };
  /** 候选漂移时按容器真实内容重建索引条目（各策略自持校验后调用） */
  reconcile(container: Container): void;
  onItemMoved(from: ContainerId, to: ContainerId, itemId: ItemId): void;
  /** 索引 miss 时全仓自愈：扫描存储容器找 hasItem 并重建条目（Router 在无候选时触发） */
  selfHeal(item: ItemStack, containers: Iterable<Container>): void;
}

export interface RouteResult {
  routed: true;
  from: ContainerId;
  to: ContainerId;
  itemId: ItemId;
  amount: number;
}

/**
 * 路由引擎：对候选容器按策略分拣，是"输入 → 目标容器"的决策中枢。
 * 每次 routeFrom 逐候选按策略判定可放入性；成功移动物品 → 触发 item-routed 领域事件
 * （统计/自动整理/预警/视觉由 Subscriptions 订阅驱动，本类不触达持久化）。
 * 构造注入 { strategies, sorter, bus }，可插拔、可测。
 */
export class Router {
  /** selfHeal 冷却表：`仓库:typeId → 最近一次自愈时刻`（滑动续期，见 selfHealGate） */
  private readonly selfHealCooldown = new Map<string, number>();

  constructor(
    private readonly strategies: RouteStrategy[],
    private readonly sorter: CandidateSorter,
    private readonly bus: EventBus,
    /** 时钟注入（默认 Date.now 墙钟；测试用假时钟） */
    private readonly now: () => number = Date.now
  ) {}

  /**
   * selfHeal 冷却门控（滑动续期）。持续命中无效索引（item 进 misc）时压制全仓自愈，
   * 避免"一大箱未分类物品每 tick 全扫一次"的瀑布流。
   * 语义（滑动）：窗口内再次命中 → 跳过本次自愈并**续期**（把时间推到 now）→ 连续无效流
   * 只扫首次、之后一直压着；流停后窗口到期，下一次同 type 才放一次全新扫描（此时可能已
   * 手动放入持有容器，恰好重新感知）。
   * @returns true = 本次应执行 selfHeal（已把时间记为 now，作为窗口起点/续期）；false = 冷却中，跳过。
   */
  private shouldScanSelfHeal(warehouseId: string, itemId: ItemId): boolean {
    const key = `${warehouseId}:${itemId}`;
    const now = this.now();
    const last = this.selfHealCooldown.get(key);
    if (last !== undefined && now - last < SELF_HEAL_COOLDOWN_MS) {
      this.selfHealCooldown.set(key, now); // 续期：持续命中则一直抑制
      return false;
    }
    this.selfHealCooldown.set(key, now);
    return true;
  }

  /**
   * 处理一个输入容器的非空 slot。
   * 每个动作仅查询该仓库自己的索引（`index` 由调用方按仓库传入）。
   * 按策略 priority 升序执行，策略内候选经排序后逐个尝试转移；
   * 第一个发生移动即返回结果；全部失败返回 undefined（物品留在源）。
   */
  routeFrom(input: Container, slot: number, warehouse: Warehouse, index: IndexGateway): RouteResult | undefined {
    const stack = input.getItem(slot);
    if (stack === undefined) return undefined;
    const originalAmount = stack.amount;
    const itemId = stack.itemId;
    // 索引 miss → 全仓自愈兜底：用户手动向单物/多物放入该类型的存储容器被漏索引时，
    // selfHeal 扫描全仓非 input/misc 容器找 hasItem 并重建条目，再查（罕见路径，不做每路由全扫）
    let candidates = index.lookup(itemId);
    // ⚠️ 记录"初始是否已有候选"：只有初始**非空**（存在 stale 候选可能被拒）才在下方走 mid 自愈——
    //   初始为空的 item，顶部 ① 已做全仓自愈且 round0 已见愈合后候选，无需 mid 再扫（避免逐 misc-item 全扫）。
    const hadCandidates = candidates.single.length > 0 || candidates.multi.length > 0;
    if (candidates.single.length === 0 && candidates.multi.length === 0 && this.shouldScanSelfHeal(warehouse.id, itemId)) {
      index.selfHeal(stack, warehouse.containers.values());
      candidates = index.lookup(itemId);
    }
    // 索引查询惰性缓存：各策略都查同一 itemId，一次路由只真正 look up 一次（索引在内存）
    let cached: { single: ContainerId[]; multi: ContainerId[] } | undefined = candidates;
    const ctx = {
      item: stack,
      warehouse,
      lookupIndex: (typeId: ItemId) => {
        if (typeId === itemId) {
          if (cached === undefined) cached = index.lookup(typeId);
          return cached;
        }
        return index.lookup(typeId);
      },
      reconcile: (c: Container) => index.reconcile(c),
    };
    const ordered = [...this.strategies].sort((a, b) => a.priority - b.priority);
    const real = ordered.filter((s) => !s.isFallback); // single / multi（真实路由）
    const fallback = ordered.filter((s) => s.isFallback); // misc（兜底）
    const attempt = (strategies: RouteStrategy[]): RouteResult | undefined => {
      for (const strategy of strategies) {
        const raw = strategy.findCandidates(ctx);
        const sorted = this.sorter.sort(raw);
        for (const candidate of sorted) {
          const target = candidate.container;
          if (!target.enabled) continue;
          const remaining = transfer({ container: input, slot }, target);
          if (remaining !== undefined && remaining.amount === originalAmount) continue; // 未移动
          const moved = originalAmount - (remaining?.amount ?? 0);
          index.onItemMoved(input.id, target.id, stack.itemId);
          this.bus.itemRouted.trigger({
            type: "item-routed",
            warehouseId: warehouse.id,
            from: input.id,
            to: target.id,
            itemId: stack.itemId,
            amount: moved,
          });
          return { routed: true, from: input.id, to: target.id, itemId: stack.itemId, amount: moved };
        }
      }
      return undefined;
    };
    // 真实策略先试两轮，第二轮前 selfHeal 重扫一次。关键（item：stale 候选堵自愈）：
    // 顶部 selfHeal 只在 lookup **完全为空**时触发——若索引残留一条 stale 候选（索引说某容器
    // 装了该 item，实际已被手动清空、无内容事件删索引），lookup 非空 → ①被跳过 → 真实策略
    // 全部校验判废 → 若不重扫会直接落 misc，漏掉"手动放入但未入索引"的真持有容器。
    // ⚠️ 成本守卫：**仅当初始已有候选**（可能含 stale）才走 mid 自愈 + 第二轮；初始为空的 item
    //    顶部 ① 已全仓自愈、无 stale 可恢复 → 直接走 misc 兜底，**不逐 misc-item 全扫**。
    for (let round = 0; round < 2; round++) {
      const r = attempt(real);
      if (r !== undefined) return r;
      if (!hadCandidates) break; // 初始无候选 → ①已处理，无需第二轮
      if (round === 0) {
        if (!this.shouldScanSelfHeal(warehouse.id, itemId)) break; // 冷却中：跳过自愈与第二轮
        // ⚠️ 先快照再自愈：`cached` 与索引的 byItem 数组**同一引用**，selfHeal 就地扩容
        //    会把 `cached` 一起改成愈合后内容 → 必须先把"愈合前"的候选 id 拷贝出来比较。
        const beforeSingle = [...(cached?.single ?? [])];
        const beforeMulti = [...(cached?.multi ?? [])];
        index.selfHeal(stack, warehouse.containers.values());
        const healed = index.lookup(itemId);
        cached = healed;
        const added =
          healed.single.some((id) => !beforeSingle.includes(id)) ||
          healed.multi.some((id) => !beforeMulti.includes(id));
        if (!added) break;
      }
    }
    // 兜底策略（misc）：真实策略两轮仍无果才执行
    return attempt(fallback);
  }
}
