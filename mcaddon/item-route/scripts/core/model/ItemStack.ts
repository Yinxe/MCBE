// ─── 概念级物品堆 ────────────────────────────────────────
// 这是全系统物品的"最小共识类型"：隔离 MC 运行时的精简视图。
// 目的：让 core 的排序/索引/统计等纯逻辑只用 {itemId, amount, maxStackSize}
// 做推理，不依赖 @minecraft/server（从而可 `pnpm test:core` 单独 node 测试）。
//
// ⚠️ 审查必读的两个语义边界：
// 1. 这是**缩减视图**，故意丢弃原始游戏物品的全部组件/NBT（附魔、耐久、药水、
//    lore、自定义标签），因此**不能无损往返**。写入回游戏时由 `McItemAdapter`
//    用模块私有 symbol SOURCE 携带源 mc.ItemStack，`toMc` 走 `clone()` 保留组件
//    （否则会吞掉附魔/耐久等数据——详见 adapters/McItemAdapter.ts）。
// 2. `isStackableWith` 仅是**类型级**判定（同 itemId）。不同 NBT 的同型物品实际
//    不可堆叠，概念层无从得知；生产写入由 `McContainerAdapter.addItem` 委托
//    `mc.addItem` 做权威的 NBT 级判定（拒绝错误合并/刷物）。此方法只作预筛，
//    供测试容器（InMemoryContainer）与整理器预判使用，生产不依赖其精确性。
import type { ItemId } from "./types";

/**
 * 概念级物品堆：itemId + 数量 + 最大堆叠，不感知 MC。
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