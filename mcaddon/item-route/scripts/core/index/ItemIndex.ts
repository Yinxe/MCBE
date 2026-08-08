// ─── O(1) 全容器物品索引：路由 + 搜索共用一个数据结构 ──
// `byItem` 是**全量通用索引**：key = itemId，value = { single, multi, misc } 各角色容器 ID 集合。
//   · 路由只读 single/multi（候选定位）；**misc 桶也纳入同一 byItem**（不参与路由，仅搜索命中），
//     未来新增容器角色天然扩展——维护代价全局唯一，不再有独立的 searchIndex 与之重叠。
// 另两张辅助表：
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



/** 单条目：各角色容器桶 */
export interface ItemBuckets {
  single: Set<ContainerId>;
  multi: Set<ContainerId>;
  misc: Set<ContainerId>;
}


function emptyBuckets(): ItemBuckets {
  return { single: new Set(), multi: new Set(), misc: new Set() };
}

/**
 * O(1) 全容器物品索引（每仓实例）：byItem 一条索引（single/multi 供路由，misc 供搜索）。
 * 路由只查索引、不做全仓扫描；搜索同样 O(1) 命中（读 misc+single+multi 桶）。
 * **纯运行时派生缓存**：不持久化——激活时按真实内容全量扫描重建（onContainerAdded），卸载即弃；权威源 = 容器内容。
 */
export class ItemIndex {
  private byItem = new Map<ItemId, ItemBuckets>();
  private containerItems = new Map<ContainerId, Set<ItemId>>();
  private singleBindings = new Map<ContainerId, ItemId>();
  /** 族 → 启族多物容器 ID（**内容派生的同族索引**：容器实含某族任一成员即入该族桶） */
  private familyContainers = new Map<string, Set<ContainerId>>();
  /** 容器 → 其覆盖的族集合（O(1) 幂等移除组桶的反向镜像） */
  private containerFamilies = new Map<ContainerId, Set<string>>();

  /** O(1) 路由查询：typeId → single/multi 候选（misc 不参与路由，故返回前不含） */
  lookup(typeId: ItemId): { single: ContainerId[]; multi: ContainerId[] } {
    const entry = this.byItem.get(typeId);
    if (!entry) return { single: [], multi: [] };
    return { single: [...entry.single], multi: [...entry.multi] };
  }

  /** O(1) 搜索查询：typeId → 含该物品的全部存储容器（single+multi+misc），无则空 */
  lookupSearch(typeId: ItemId): ContainerId[] {
    const entry = this.byItem.get(typeId);
    if (!entry) return [];
    return [...new Set([...entry.single, ...entry.multi, ...entry.misc])];
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
   * 轻量更新：路由自身移动物品后，**同时刷新 byItem 角色桶**（O(1) 幂等）：
   *   · 目标 misc   → misc 桶登记（**否则路由进 misc 后搜索 lookupSearch 搜不到**：misc 是
   *     兜底层，不进路由候选，无专项增补——必须在此补 `byItem[itemId].misc`）
   *   · 目标 multi  → multi 桶登记（补齐**白名单声明式 MultiItemStrategy 缺卡多物容器**的桶：
   *     白名单路由未走内容索引，若不补，同型搜索/后续 O(1) 路由会 miss）
   *   · 目标 single → single 桶（绑定型，幂等）
   * 来源侧留待惰性校验清理（reconcile 全量重建；见"三层兜底"）。
   * containerItems（容器→物品）与家族桶同样此处理。
   */
  onItemMoved(from: Container, to: Container, itemId: ItemId): void {
    this.containerItems.get(from.id)?.delete(itemId);
    const toItems = this.containerItems.get(to.id);
    if (toItems) toItems.add(itemId);
    // 目标角色对应桶同步登记（O(1) 幂等）：路由移动即刻对搜索/路由可见
    const entry = this.ensureEntry(itemId);
    if (to.role === "single") {
      // 用**实时绑定**（容器侧派生）而非索引缓存：白名单空单物首件进箱后，索引缓存尚无绑定，
      // 读缓存会误判漂移漏登记 → 实时对比 + 顺带回填缓存，保证首件即可搜/可路由
      if (to.getDedicatedItemId() === itemId) {
        this.singleBindings.set(to.id, itemId);
        entry.single.add(to.id);
      }
      // 漂移（绑定与其不符的其它类型）不强行登记，交 reconcile 按真实内容重建
    } else if (to.role === "multi") {
      entry.multi.add(to.id);
    } else if (to.role === "misc") {
      entry.misc.add(to.id);
    }
    if (to.role === "multi" && to.familyEnabled) {
      const fam = familyOf(itemId);
      if (fam !== undefined) this.addContainerToFamily(to.id, fam);
    }
  }

  /** 按容器**真实内容**重建其索引条目（remove + rebuild）。 */
  reconcile(container: Container): void {
    this.onContainerChanged(container);
  }

  /**
   * 索引自愈（漏索引兜底）：无候选时扫描给定**存储容器**集，凡**逐槽 typeId 匹配**（类型级，
   * 与 multi 候选 hasItemType / 测试 InMemoryContainer.contains 语义一致，不做 NBT 敏感判定）
   * 的按真实内容重建条目。只扫非 input/misc（路由候选中自愈；搜索命中 misc 由搜索侧自行 reconcile）。
   * 仅索引 miss（罕见）时由 Router 触发。
   */
  selfHeal(item: ItemStack, containers: Iterable<Container>): void {
    for (const container of containers) {
      if (container.role === "input" || container.role === "misc") continue;
      if (!hasItemOfType(container, item.itemId)) continue;
      this.reconcile(container);
    }
  }

  // ── 私有方法 ───────────────────────────────────────────
  private ensureEntry(itemId: ItemId): ItemBuckets {
    let entry = this.byItem.get(itemId);
    if (!entry) {
      entry = emptyBuckets();
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
      this.rebuildContainerFamilies(container, items);
    } else if (container.role === "misc") {
      // misc 容器：不参与路由，但仍登记 byItem.misc → 搜索可命中
      for (const itemId of items) {
        this.ensureEntry(itemId).misc.add(container.id);
      }
    }
  }

  private rebuildContainerFamilies(container: Container, items: Set<ItemId>): void {
    if (!container.familyEnabled) return;
    for (const itemId of items) {
      const fam = familyOf(itemId);
      if (fam !== undefined) this.addContainerToFamily(container.id, fam);
    }
  }

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
        const entry = this.byItem.get(itemId);
        if (entry) {
          entry.multi.delete(containerId);
          entry.misc.delete(containerId);
        }
      }
    }
    this.containerItems.delete(containerId);
    const fams = this.containerFamilies.get(containerId);
    if (fams) {
      for (const fam of fams) this.familyContainers.get(fam)?.delete(containerId);
      this.containerFamilies.delete(containerId);
    }
  }
}
/** 容器是否含某 typeId（逐槽类型级比对，不做 NBT 敏感判定——与 multi 候选语义一致） */
function hasItemOfType(container: Container, typeId: string): boolean {
  for (let i = 0; i < container.capacity; i++) {
    const item = container.getItem(i);
    if (item !== undefined && item.itemId === typeId) return true;
  }
  return false;
}
