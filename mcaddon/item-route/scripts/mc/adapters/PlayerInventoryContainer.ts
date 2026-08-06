// ─── 玩家背包整理适配器：把背包主栏（槽 9~35）包装成 core Container ──
// 供"潜行点非容器 → 背包整理"使用（v1 同款：只整理主栏 27 格，不动快捷栏/盔甲/副手）。
// 槽位映射：core 槽 0..26 ↔ mc 槽 9..35（offset=9），capacity=27。
//
// 关键安全点（对齐 v1 SlotOrganizer 的 NBT 判定）：
//   · 合并判定用 McItemAdapter.isStackableWith（带源堆走原生 mc.ItemStack.isStackableWith，
//     NBT 级；无源退化为类型级同 id）——防"同型不同 NBT（附魔/耐久/药水）被错误合并"。
//   · 写入经 setItem → toMc（clone 源保留全部组件），不吞不覆盖不刷。
//   · addItem 被**限制在子区间内**：只填/并主栏槽位，绝不把物品放进快捷栏（mc.addItem
//     会从槽 0 开始填，若委托它会污染快捷栏——这正是本适配器不复用 mc.addItem 的原因）。
import type { Container, ContainerRole } from "../../core/model/Container";
import type { ItemStack } from "../../core/model/ItemStack";
import type { ContainerId, ItemId, Location, WarehouseId } from "../../core/model/types";
import type { McItemAdapter } from "./McItemAdapter";
import type { Container as McContainer } from "@minecraft/server";

/** 背包主栏起始槽（mc 槽位：0-8 快捷栏 / 9-35 主栏 / 36-39 盔甲 / 40 副手） */
const INVENTORY_OFFSET = 9;
/** 主栏槽位数（9..35） */
const MAIN_SLOTS = 27;

/**
 * 玩家背包主栏的 core Container 适配（只读/写主栏子区间）。
 * 不属于任何仓库（warehouseId 空），仅供 OrganizeService.organizeStandalone 就地整理。
 */
export class PlayerInventoryContainer implements Container {
  readonly id: ContainerId;
  warehouseId: WarehouseId = "";
  role: ContainerRole = "misc";
  enabled = true;
  warningEnabled = true;
  priority = 0;
  readonly capacity = MAIN_SLOTS;
  readonly occupiedLocations: Location[] = [];

  constructor(
    id: ContainerId,
    private readonly mc: McContainer,
    private readonly item: McItemAdapter
  ) {
    this.id = id;
  }

  get emptySlotsCount(): number {
    return this.capacity - this.usedSlots;
  }

  get usedSlots(): number {
    let used = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.mc.getItem(this.offset(i)) !== undefined) used++;
    }
    return used;
  }

  getItem(slot: number): ItemStack | undefined {
    try {
      return this.item.toDomain(this.mc.getItem(this.offset(slot)));
    } catch {
      return undefined;
    }
  }

  setItem(slot: number, item?: ItemStack): void {
    try {
      this.mc.setItem(this.offset(slot), item === undefined ? undefined : this.item.toMc(item));
    } catch {
      // 容器失效：静默（整理失败由数量守恒校验兜底回滚）
    }
  }

  /**
   * 放入主栏子区间：只填/并主栏槽位（从子区间槽 0 开始）。
   * 合并判定 NBT 级（McItemAdapter.isStackableWith），写入经 setItem 保留组件。
   * 返回剩余（未放入部分），全部放入返回 undefined。
   */
  addItem(stack: ItemStack): ItemStack | undefined {
    let remaining = stack.clone();
    for (let i = 0; i < this.capacity; i++) {
      const slot = this.getItem(i);
      if (slot === undefined) {
        this.setItem(i, remaining);
        return undefined;
      }
      if (this.item.isStackableWith(slot, remaining) && slot.amount < slot.maxStackSize) {
        const room = slot.maxStackSize - slot.amount;
        const put = Math.min(room, remaining.amount);
        // 合并后的槽 = 原槽克隆（保留 NBT 源）+ 增量数量；必须 setItem 写回（getItem 是副本）
        const merged = slot.clone();
        merged.amount = slot.amount + put;
        this.setItem(i, merged);
        remaining.amount -= put;
        if (remaining.amount === 0) return undefined;
      }
    }
    return remaining;
  }

  getDedicatedItemId(): ItemId | undefined {
    return this.firstNoEmptyItem() !== undefined ? this.getItem(this.firstNoEmptyItem()!)!.itemId : undefined;
  }

  // ── 便捷搜索（与 mc 适配层同语义；线性扫描子区间） ──
  firstNoEmptyItem(): number | undefined {
    for (let i = 0; i < this.capacity; i++) {
      if (this.getItem(i) !== undefined) return i;
    }
    return undefined;
  }

  lastNoEmptyItem(): number | undefined {
    for (let i = this.capacity - 1; i >= 0; i--) {
      if (this.getItem(i) !== undefined) return i;
    }
    return undefined;
  }

  firstEmptySlot(): number | undefined {
    for (let i = 0; i < this.capacity; i++) {
      if (this.getItem(i) === undefined) return i;
    }
    return undefined;
  }

  contains(itemStack: ItemStack): boolean {
    return this.find(itemStack) !== undefined;
  }

  find(itemStack: ItemStack): number | undefined {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.getItem(i);
      if (s !== undefined && this.item.isStackableWith(s, itemStack)) return i;
    }
    return undefined;
  }

  findLast(itemStack: ItemStack): number | undefined {
    for (let i = this.capacity - 1; i >= 0; i--) {
      const s = this.getItem(i);
      if (s !== undefined && this.item.isStackableWith(s, itemStack)) return i;
    }
    return undefined;
  }

  /** 子区间槽 → mc 真实槽 */
  private offset(slot: number): number {
    return INVENTORY_OFFSET + slot;
  }
}
