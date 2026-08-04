// ─── 概念级物品堆 ────────────────────────────────────────
import type { ItemId } from "./types";

/** 概念级物品堆：itemId + 数量 + 最大堆叠，不感知 MC */
export interface ItemStack {
  readonly itemId: ItemId;
  amount: number;
  readonly maxStackSize: number;
  /** 是否可与此堆堆叠（默认同 itemId） */
  isStackableWith(other: ItemStack): boolean;
  /** 深度相等（含元数据与数量） */
  equals(other: ItemStack): boolean;
  clone(): ItemStack;
}

/** 默认物品堆实现 */
export class SimpleItemStack implements ItemStack {
  readonly itemId: ItemId;
  amount: number;
  readonly maxStackSize: number;

  constructor(itemId: ItemId, amount: number, maxStackSize: number) {
    this.itemId = itemId;
    this.amount = amount;
    this.maxStackSize = maxStackSize;
  }

  isStackableWith(other: ItemStack): boolean {
    return this.itemId === other.itemId;
  }

  equals(other: ItemStack): boolean {
    return this.itemId === other.itemId && this.amount === other.amount && this.maxStackSize === other.maxStackSize;
  }

  clone(): ItemStack {
    return new SimpleItemStack(this.itemId, this.amount, this.maxStackSize);
  }
}