// 测试用概念容器实现（产品代码中由 mc 适配层提供真实实现）
import type { Container, ContainerRole } from "../../scripts/core/model/Container";
import type { ItemStack } from "../../scripts/core/model/ItemStack";
import type { ContainerId, ItemId, Location, WarehouseId } from "../../scripts/core/model/types";

export class InMemoryContainer implements Container {
  readonly id: ContainerId;
  /** 所属仓库 ID（registerContainer 装配时写入） */
  warehouseId!: WarehouseId;
  role: ContainerRole;
  enabled = true;
  priority = 10;
  readonly capacity: number;
  readonly occupiedLocations: Location[];
  private slots: (ItemStack | undefined)[];

  constructor(id: ContainerId, role: ContainerRole, capacity: number, occupiedLocations: Location[] = []) {
    this.id = id;
    this.role = role;
    this.capacity = capacity;
    this.occupiedLocations = occupiedLocations;
    this.slots = new Array<ItemStack | undefined>(capacity).fill(undefined);
  }

  get emptySlotsCount(): number {
    return this.slots.filter((s) => s === undefined).length;
  }

  get usedSlots(): number {
    return this.slots.filter((s) => s !== undefined).length;
  }

  getItem(slot: number): ItemStack | undefined {
    return this.slots[slot];
  }

  setItem(slot: number, item?: ItemStack): void {
    this.slots[slot] = item;
  }

  addItem(stack: ItemStack): ItemStack | undefined {
    let remaining = stack.clone();
    for (let i = 0; i < this.capacity; i++) {
      const slot = this.slots[i];
      if (slot === undefined) {
        this.slots[i] = remaining;
        return undefined;
      }
      if (slot.isStackableWith(remaining) && slot.amount < slot.maxStackSize) {
        const room = slot.maxStackSize - slot.amount;
        const put = Math.min(room, remaining.amount);
        slot.amount += put;
        if (remaining.amount - put === 0) {
          return undefined;
        }
        remaining.amount -= put;
      }
    }
    return remaining.amount === stack.amount ? stack : remaining;
  }

  getDedicatedItemId(): ItemId | undefined {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (s !== undefined) return s.itemId;
    }
    return undefined;
  }

  // ── 便捷搜索（与 mc 适配层同语义；测试容器用线性扫描实现） ──
  firstNoEmptyItem(): number | undefined {
    for (let i = 0; i < this.capacity; i++) {
      if (this.slots[i] !== undefined) return i;
    }
    return undefined;
  }

  lastNoEmptyItem(): number | undefined {
    for (let i = this.capacity - 1; i >= 0; i--) {
      if (this.slots[i] !== undefined) return i;
    }
    return undefined;
  }

  firstEmptySlot(): number | undefined {
    for (let i = 0; i < this.capacity; i++) {
      if (this.slots[i] === undefined) return i;
    }
    return undefined;
  }

  contains(itemStack: ItemStack): boolean {
    return this.find(itemStack) !== undefined;
  }

  find(itemStack: ItemStack): number | undefined {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (s !== undefined && s.isStackableWith(itemStack)) return i;
    }
    return undefined;
  }

  findLast(itemStack: ItemStack): number | undefined {
    for (let i = this.capacity - 1; i >= 0; i--) {
      const s = this.slots[i];
      if (s !== undefined && s.isStackableWith(itemStack)) return i;
    }
    return undefined;
  }
}
