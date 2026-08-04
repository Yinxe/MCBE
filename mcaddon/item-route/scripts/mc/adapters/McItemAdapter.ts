// ─── 物品适配器：mc.ItemStack ↔ 概念 ItemStack ──
import { ItemStack as McItemStack } from "@minecraft/server";
import type { ItemStack } from "../../core/model/ItemStack";

/** 构造概念 ItemStack（含接口要求的方法） */
function domainStack(itemId: string, amount: number, maxStackSize: number): ItemStack {
  const self = (): ItemStack => domainStack(itemId, amount, maxStackSize);
  return {
    itemId,
    amount,
    maxStackSize,
    isStackableWith: (other) => other.itemId === itemId,
    equals: (other) => other.itemId === itemId && other.amount === amount && other.maxStackSize === maxStackSize,
    clone: self,
  };
}

export class McItemAdapter {
  toDomain(stack: McItemStack | undefined): ItemStack | undefined {
    if (stack === undefined) return undefined;
    return domainStack(stack.typeId, stack.amount, stack.maxAmount);
  }

  toMc(stack: ItemStack): McItemStack {
    return new McItemStack(stack.itemId, stack.amount);
  }
}