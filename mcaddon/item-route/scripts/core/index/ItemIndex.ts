// ─── O(1) 物品索引：查询/增量维护/惰性校验/持久化快照 ──
// 本模块是"路由只查索引、不做全仓扫描"的底座。三张表（内存 Map）：
//   · byItem         typeId → { single[], multi[] } 候选容器 ID（O(1) 定位）
//   · containerItems 容器 ID → 其含有的 typeId 集合（增量维护用）
//   · singleBindings 单物容器 ID → 绑定类型（由 deriveBinding 推导）
//
// ⚠️ 索引漂移与"三层兜底"（设计 §5，审查必读）：
// MC 没有容器内容变化事件（玩家手动改箱无法被监听）→ 索引必然可能过期。
// 收敛机制：① 代理信号（玩家交互/放置/破坏 → reconcile/onContainerChanged/Added/Removed）
//            ② 策略侧惰性校验（候选命中时各策略自行校验：单物查绑定、多物查 contains，
//               不匹配 → reconcile 按真实内容重建条目——见 RouteStrategy）
//            ③ 空箱重绑（玩家取走唯一物 → 空 → 移除；再来物由 proxy 信号重建）
// 另：`onItemMoved` 是"路由自身移动"后的轻量更新（只改目标侧 containerItems；
// 来源侧条目留待惰性校验清理）——避免每路由一次全量重算。
import type { Container, ContainerRole } from "../model/Container";
import { deriveBinding } from "../model/DeriveBinding";
import { familyOf } from "../data/item-families";
import type { ItemStack } from "../model/ItemStack";
import type { ContainerId, ItemId } from "../model/types";

export const INDEX_VERSION = 1;

export interface IndexSnapshot {
  version: number;
  byItem: Record<ItemId, { single: ContainerId[]; multi: ContainerId[] }>;
  containerItems: Record<ContainerId, ItemId[]>;
  singleBindings: Record<ContainerId, ItemId>;
  /** 派生族索引（familyId → 启族多物容器 ID[]），随全量快照卷走（serialize/restore） */
  familyContainers: Record<string, ContainerId[]>;
}

/**
 * O(1) 物品索引（每仓实例）：byItem(typeId→候选) / containerItems(容器→物品) / singleBindings(单物绑定)。
 * 路由只查索引、不做全仓扫描；漂移由"三层兜底"（代理信号 reconcile + 策略惰性校验 + 空箱重绑）自愈。
 * 持久化为**每容器一条条目**（serializeContainer/restoreFromEntries），与注册表/统计同风格。
 * 此 class 为每仓隔离实例（Scheduler 激活/卸载加载），不进 MC 层，可单测。
 */
export class ItemIndex {
  private byItem = new Map<ItemId, { single: Set<ContainerId>; multi: Set<ContainerId> }>();
  private containerItems = new Map<ContainerId, Set<ItemId>>();
  private singleBindings = new Map<ContainerId, ItemId>();
  /** 族 → 启族多物容器 ID（**内容派生的同族索引**：容器实含某族任一成员即入该族桶） */
  private familyContainers = new Map<string, Set<ContainerId>>();
  /** 容器 → 其覆盖的族集合（O(1) 幂等移除族桶的反向镜像） */
  private containerFamilies = new Map<ContainerId, Set<string>>();

  /** O(1) 查询：typeId → 候选容器 ID（按角色分组） */
  lookup(typeId: ItemId): { single: ContainerId[]; multi: ContainerId[] } {
    const entry = this.byItem.get(typeId);
    if (!entry) return { single: [], multi: [] };
    return { single: [...entry.single], multi: [...entry.multi] };
  }

  /** O(1) 族查询：familyId → 启族多物容器 ID[]（同族路由候选，复用多物索引派生） */
  lookupFamily(familyId: string): ContainerId[] {
    return [...(this.familyContainers.get(familyId) ?? [])];
  }

  getBinding(containerId: ContainerId): ItemId | undefined {
    return this.singleBindings.get(containerId);
  }

  /** 容器加入仓库（注册/激活时） */
  onContainerAdded(container: Container): void {
    this.rebuildContainer(container);
  }

  /** 容器内容变化（代理信号触发）：全量重算该容器 */
  onContainerChanged(container: Container): void {
    this.removeContainerEntries(container.id);
    this.rebuildContainer(container);
  }

  /** 角色变更（previousRole 仅作信息，实为全量重建） */
  onContainerRoleChanged(container: Container, previousRole?: ContainerRole): void {
    void previousRole;
    this.onContainerChanged(container);
  }

  /** 容器移除/方块破坏 */
  onContainerRemoved(container: Container): void {
    this.removeContainerEntries(container.id);
  }

  /**
   * 轻量更新：路由自身移动物品后只更新目标侧（来源侧留待惰性校验清理）。
   * 额外维护**族桶**：物品路由进启族多物容器时新增族（from 恒为 input，非族桶候选，无需清理）。
   * 需要目标容器对象以判 familyEnabled/role → 签名传 Container 而非仅 id。
   */
  onItemMoved(from: Container, to: Container, itemId: ItemId): void {
    this.containerItems.get(from.id)?.delete(itemId);
    const toItems = this.containerItems.get(to.id);
    if (toItems) toItems.add(itemId);
    // 同族：item 路由进启族多物容器 → 若引入新族则增补族桶（幂等），供后续族内其他成员感知
    if (to.role === "multi" && to.familyEnabled) {
      const fam = familyOf(itemId);
      if (fam !== undefined) this.addContainerToFamily(to.id, fam);
    }
  }

  /**
   * 按容器**真实内容**重建其索引条目（remove + rebuild）。
   * 由策略侧惰性校验在候选命中时调用（单物绑定漂移/容器清空 → 修复或移除过期候选）。
   * 等价于 onContainerChanged 全量重算，是"三层兜底之第二层"的落地。
   */
  reconcile(container: Container): void {
    this.onContainerChanged(container);
  }

  /**
   * 索引自愈（漏索引兜底）：无候选时扫描给定**存储容器**集，凡 `contains(item)` 的
   * 按真实内容重建条目（含 byItem 分组）。解决"用户手动向单物/多物放入某类型但索引未记录
   * → 路由漏配该类型直接落 misc"。只扫描**非 input/非 misc**（misc 是兜底桶、input 是源，
   * 都不作为路由候选）；仅索引 miss（罕见）时由 Router 触发，不做每路由全仓扫描。
   */
  selfHeal(item: ItemStack, containers: Iterable<Container>): void {
    for (const container of containers) {
      if (container.role === "input" || container.role === "misc") continue;
      if (!container.contains(item)) continue;
      this.reconcile(container);
    }
  }

  serialize(): IndexSnapshot {
    const byItem: IndexSnapshot["byItem"] = {};
    for (const [itemId, entry] of this.byItem) {
      byItem[itemId] = { single: [...entry.single], multi: [...entry.multi] };
    }
    const containerItems: IndexSnapshot["containerItems"] = {};
    for (const [id, items] of this.containerItems) {
      containerItems[id] = [...items];
    }
    const singleBindings: IndexSnapshot["singleBindings"] = {};
    for (const [id, itemId] of this.singleBindings) {
      singleBindings[id] = itemId;
    }
    const familyContainers: IndexSnapshot["familyContainers"] = {};
    for (const [fam, set] of this.familyContainers) {
      familyContainers[fam] = [...set];
    }
    return { version: INDEX_VERSION, byItem, containerItems, singleBindings, familyContainers };
  }

  /** 恢复快照；版本不匹配返回 false（调用方应重建） */
  restore(snapshot: IndexSnapshot): boolean {
    if (snapshot.version !== INDEX_VERSION) return false;
    this.byItem = new Map();
    this.containerItems = new Map();
    this.singleBindings = new Map();
    this.familyContainers = new Map();
    this.containerFamilies = new Map();
    for (const [itemId, entry] of Object.entries(snapshot.byItem)) {
      this.byItem.set(itemId, {
        single: new Set(entry.single),
        multi: new Set(entry.multi),
      });
    }
    for (const [id, items] of Object.entries(snapshot.containerItems)) {
      this.containerItems.set(id, new Set(items));
    }
    for (const [id, itemId] of Object.entries(snapshot.singleBindings)) {
      this.singleBindings.set(id, itemId);
    }
    for (const [fam, ids] of Object.entries(snapshot.familyContainers)) {
      this.familyContainers.set(fam, new Set(ids));
    }
    return true;
  }

  /**
   * 单容器索引条目（持久化**最小单位**）：该容器的物品集 + 单物绑定。
   * 供 mc 层按容器粒度落盘（ir2:idx:{cid}），事件驱动、只写改动的那一个容器。
   */
  serializeContainer(containerId: ContainerId): { items: string[]; singleBinding?: string } {
    const items = this.containerItems.get(containerId);
    return {
      items: items ? [...items] : [],
      singleBinding: this.singleBindings.get(containerId),
    };
  }

  /**
   * 由**每容器条目**恢复索引（激活加载用）。条目来自 mc 层各容器键。
   * 任一容器缺条目（结构变更后未落盘）→ 返回 false，调用方回退全容器扫描重建。
   * byItem 由 items+role 反演（singleBinding 优先于 role 分组）。
   */
  restoreFromEntries(
    entries: ReadonlyMap<ContainerId, { items: string[]; singleBinding?: string }>,
    containers: Iterable<Container>
  ): boolean {
    this.byItem = new Map();
    this.containerItems = new Map();
    this.singleBindings = new Map();
    this.familyContainers = new Map();
    this.containerFamilies = new Map();
    for (const container of containers) {
      const entry = entries.get(container.id);
      if (entry === undefined) return false;
      this.restoreContainerFromEntry(container, entry);
    }
    return true;
  }

  private restoreContainerFromEntry(container: Container, entry: { items: string[]; singleBinding?: string }): void {
    this.containerItems.set(container.id, new Set(entry.items));
    const binding = entry.singleBinding;
    if (binding !== undefined) {
      this.singleBindings.set(container.id, binding);
      this.ensureEntry(binding).single.add(container.id);
    } else if (container.role === "multi") {
      for (const itemId of entry.items) this.ensureEntry(itemId).multi.add(container.id);
      // 同族派生：启族多物容器按条目物品重算族桶（familyContainers 纯派生，不经每容器条目）
      if (container.familyEnabled) {
        for (const itemId of entry.items) {
          const fam = familyOf(itemId);
          if (fam !== undefined) this.addContainerToFamily(container.id, fam);
        }
      }
    }
  }

  // ── 私有方法 ───────────────────────────────────────────
  private ensureEntry(itemId: ItemId): { single: Set<ContainerId>; multi: Set<ContainerId> } {
    let entry = this.byItem.get(itemId);
    if (!entry) {
      entry = { single: new Set(), multi: new Set() };
      this.byItem.set(itemId, entry);
    }
    return entry;
  }

  private rebuildContainer(container: Container): void {
    const items = new Set<ItemId>();
    for (let i = 0; i < container.capacity; i++) {
      const item = container.getItem(i);
      if (item !== undefined) items.add(item.itemId);
    }
    this.containerItems.set(container.id, items);
    if (container.role === "single") {
      const binding = deriveBinding(container);
      if (binding !== undefined) {
        this.singleBindings.set(container.id, binding);
        this.ensureEntry(binding).single.add(container.id);
      } else {
        this.singleBindings.delete(container.id);
      }
      return;
    }
    if (container.role === "multi") {
      for (const itemId of items) {
        this.ensureEntry(itemId).multi.add(container.id);
      }
      // 同族索引：启族多物容器按**实际内容**派生所属族（存白羊毛 → 入羊毛族桶 → 可收全族羊毛）。
      // 与多物索引同源（containerItems），是"复用多物索引派生族桶"的落地：先建好多物条目，
      // 再由 FAMILY_BY_ITEM 投影出族桶，无需另查全仓。
      this.rebuildContainerFamilies(container, items);
    }
  }

  /** 启族多物容器：按内容物品派生族桶（removeContainerEntries 已清旧 → 此处全量重建幂等） */
  private rebuildContainerFamilies(container: Container, items: Set<ItemId>): void {
    if (!container.familyEnabled) return;
    for (const itemId of items) {
      const fam = familyOf(itemId);
      if (fam !== undefined) this.addContainerToFamily(container.id, fam);
    }
  }

  /** 把容器放进某族桶 + 记入 containerFamilies 反向镜像（幂等，Set 去重） */
  private addContainerToFamily(containerId: ContainerId, fam: string): void {
    let bucket = this.familyContainers.get(fam);
    if (!bucket) {
      bucket = new Set();
      this.familyContainers.set(fam, bucket);
    }
    bucket.add(containerId);
    let cfam = this.containerFamilies.get(containerId);
    if (!cfam) {
      cfam = new Set();
      this.containerFamilies.set(containerId, cfam);
    }
    cfam.add(fam);
  }

  private removeContainerEntries(containerId: ContainerId): void {
    const binding = this.singleBindings.get(containerId);
    if (binding !== undefined) {
      this.byItem.get(binding)?.single.delete(containerId);
      this.singleBindings.delete(containerId);
    }
    const items = this.containerItems.get(containerId);
    if (items) {
      for (const itemId of items) {
        this.byItem.get(itemId)?.multi.delete(containerId);
      }
    }
    this.containerItems.delete(containerId);
    // 清该容器全部族桶成员资格（containerFamilies 镜像 O(1)，避免逐族全扫）
    const fams = this.containerFamilies.get(containerId);
    if (fams) {
      for (const fam of fams) this.familyContainers.get(fam)?.delete(containerId);
      this.containerFamilies.delete(containerId);
    }
  }
}
