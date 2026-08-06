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

/**
 * 构造概念 ItemStack（工厂函数，每次调用产生**独立新对象**）。
 * `clone()` 也走本工厂（透传 source）→ 得到一份彼此独立、但共享同一只读
 * source 引用的新堆。**这不是递归**：本函数体从不调用自身，`clone` 只是
 * 一个"再调一次工厂"的惰性回调（仅在被调用时才执行，无无限循环）。
 * 之所以必须经工厂而非浅拷贝：接口要求 clone 是独立对象（改 amount 不影响原堆），
 * 且 clone 后 amount 可能被 core 调整，仍需能回到 source（toMc 用）。
 */
function domainStack(itemId: string, amount: number, maxStackSize: number, source?: McItemStack): ItemStack {
  const obj: DomainStack = {
    itemId,
    amount,
    maxStackSize,
    isStackableWith: (other) => other.itemId === itemId,
    equals: (other) => other.itemId === itemId && other.amount === amount && other.maxStackSize === maxStackSize,
    // clone = 再调一次工厂（新对象、同 source 引用）；非递归，见上方说明
    clone: () => domainStack(itemId, amount, maxStackSize, source),
  };
  if (source !== undefined) obj[SOURCE] = source;
  return obj;
}

/**
 * 物品适配器：MC ItemStack ↔ core ItemStack 的双向转换（纯映射，无状态）。
 * toDomain 保留 maxAmount + 缓存组件属性，供 core 侧 addItem/contains 的 NBT 级判定；
 * toMc 把 core 堆叠物转回 MC 物品。隔离核心概念层对 MC 类型的依赖。
 */
export class McItemAdapter {
  toDomain(stack: McItemStack | undefined): ItemStack | undefined {
    if (stack === undefined) return undefined;
    return domainStack(stack.typeId, stack.amount, stack.maxAmount, stack);
  }

  /**
   * NBT 级可堆叠判定：两堆都带源（来自真实槽位）→ 走原生 mc.ItemStack.isStackableWith
   * （同型不同 NBT 如附魔/耐久/药水不合并）；任一无源 → 退化为类型级同 itemId。
   * 供 PlayerInventoryContainer 的 addItem/find 用（背包整理不委托 mc.addItem，
   * 因 mc.addItem 会从槽 0 开始填快捷栏；此处显式按 NBT 判定合并）。
   */
  isStackableWith(a: ItemStack, b: ItemStack): boolean {
    const sa = (a as DomainStack)[SOURCE];
    const sb = (b as DomainStack)[SOURCE];
    if (sa !== undefined && sb !== undefined) return sa.isStackableWith(sb);
    return a.itemId === b.itemId;
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
