// ─── 概念级物品堆 ────────────────────────────────────────
import type { ItemId } from "./types";

/**
 * 概念级物品堆：itemId + 数量 + 最大堆叠，不感知 MC。
 *
 * ⚠️ 堆叠语义边界：`isStackableWith` 是**类型级**判定（同 itemId）。
 * 不同 NBT/组件（自定义名、附魔、药水、lore、耐久）的同型物品**不可堆叠**，
 * 但概念层无从得知——生产路径由 `McContainerAdapter.addItem` 委托
 * `mc.addItem` 做**权威的 NBT 级判定**（拒绝错误合并）。本方法仅作预筛，
 * 供测试容器（InMemoryContainer）与整理器预判使用。
 */
export interface ItemStack {
  readonly itemId: ItemId;
  amount: number;
  readonly maxStackSize: number;
  /** 是否可与此堆堆叠（类型级：默认同 itemId；NBT 级由适配层 mc.addItem 裁决） */
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