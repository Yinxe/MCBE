// ─── 物品适配器：mc.ItemStack ↔ 概念 ItemStack ──
// 关键安全点：域 ItemStack 是缩减视图（id/数量/堆叠上限），
// 丢失原始物品的全部游戏数据（附魔/耐久/药水/自定义组件）。
// 为不吞物/不覆盖/不刷物，toDomain 以模块私有 symbol 携带源 mc.ItemStack，
// toMc 优先 clone 源（保留全部组件）再调整数量，绝不无中生有重建。
// core 层见不到该 symbol，保持零 MC 依赖。
import { ItemStack as McItemStack } from "@minecraft/server";
import type { ItemStack } from "../../core/model/ItemStack";

/** 模块私有：携带源 mc.ItemStack 的标记（core 不可见） */
const SOURCE: unique symbol = Symbol("itemroute.sourceMcStack");

interface DomainStack extends ItemStack {
  [SOURCE]?: McItemStack;
}

/** 构造概念 ItemStack（含接口要求的方法 + 源引用） */
function domainStack(itemId: string, amount: number, maxStackSize: number, source?: McItemStack): ItemStack {
  // clone 时透传 source，保证 transfer 的 clone().amount 调整后仍可回源
  const self = (): ItemStack => domainStack(itemId, amount, maxStackSize, source);
  const obj: DomainStack = {
    itemId,
    amount,
    maxStackSize,
    isStackableWith: (other) => other.itemId === itemId,
    equals: (other) => other.itemId === itemId && other.amount === amount && other.maxStackSize === maxStackSize,
    clone: self,
  };
  if (source !== undefined) obj[SOURCE] = source;
  return obj;
}

export class McItemAdapter {
  toDomain(stack: McItemStack | undefined): ItemStack | undefined {
    if (stack === undefined) return undefined;
    return domainStack(stack.typeId, stack.amount, stack.maxAmount, stack);
  }

  /**
   * 还原为 mc.ItemStack：若域堆携带源（来自真实槽位），
   * clone 源以保留全部组件，仅调整数量；否则重建（新物品无源）。
   */
  toMc(stack: ItemStack): McItemStack {
    const src = (stack as DomainStack)[SOURCE];
    if (src !== undefined) {
      const out = src.clone(); // 保留附魔/耐久/自定义数据
      out.amount = stack.amount;
      return out;
    }
    return new McItemStack(stack.itemId, stack.amount);
  }
}