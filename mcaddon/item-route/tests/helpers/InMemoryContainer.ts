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
  warningEnabled = true;
  priority = 10;
  /** 同族开关：多物容器开启后，装有某族任一成员即可收纳该族全部物品 */
  familyEnabled = true;
  /** 容器级白名单：非空时仅收纳列表内物品 */
  whitelist: string[] = [];
  /** 容器级黑名单：永不收纳这些物品 */
  blacklist: string[] = [];
  readonly capacity: number;
  readonly occupiedLocations: Location[];
  /** 源方块类型 ID（缺省空=未知方块；潜影盒防套娃规则据此判定） */
  blockType: string = "";
  private slots: (ItemStack | undefined)[];
  /** 测试用失联标记（模拟活塞移动/摧毁后底层读取抛错）：markLost() 置位 → isLost() 返回 true；recoverLost() 清 */
  private lost = false;

  constructor(id: ContainerId, role: ContainerRole, capacity: number, occupiedLocations: Location[] = []) {
    this.id = id;
    this.role = role;
    this.capacity = capacity;
    this.occupiedLocations = occupiedLocations;
    this.slots = new Array<ItemStack | undefined>(capacity).fill(undefined);
  }

  /** 测试用：标记容器失联（活塞移动/摧毁场景） */
  markLost(): void {
    this.lost = true;
  }

  /** 测试用：模拟恢复（活塞推回 / 重新放盒） */
  recoverLost(): void {
    this.lost = false;
  }

  /** 是否失联（生产=McContainerAdapter 懒标记+恢复复查；测试容器用 markLost/recoverLost 驱动） */
  isLost(): boolean {
    return this.lost;
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
