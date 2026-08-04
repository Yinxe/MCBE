// ─── 原子移动与事务日志（核心安全机制：不吞物/不复制/可回滚） ──
import type { Container } from "../model/Container";
import type { ItemStack } from "../model/ItemStack";

export interface SlotRef {
  container: Container;
  slot: number;
}

/**
 * 原子移动：从源槽取出 → 目标放入 → 剩余放回源槽。
 * 返回剩余（undefined = 全部移走；剩余 === 原堆 = 未移动）。
 * 仅堆叠与移动，绝不修改物品本身。
 */
export function transfer(from: SlotRef, to: Container): ItemStack | undefined {
  const stack = from.container.getItem(from.slot);
  if (stack === undefined) return undefined;
  const remaining = to.addItem(stack.clone());
  if (remaining === undefined) {
    from.container.setItem(from.slot, undefined);
    return undefined;
  }
  if (remaining.amount === stack.amount) {
    // 完全未放入：源不动
    return stack;
  }
  from.container.setItem(from.slot, remaining);
  return remaining;
}

/**
 * 单 tick 事务日志：apply 前快照受影响容器，失败时逆序恢复。
 * 语义：要么全成功要么全回滚。
 */
export class MoveJournal {
  private snapshots: { container: Container; slots: (ItemStack | undefined)[] }[] = [];

  /** 快照容器全部槽位 */
  snapshot(container: Container): void {
    const slots: (ItemStack | undefined)[] = [];
    for (let i = 0; i < container.capacity; i++) {
      slots.push(container.getItem(i)?.clone());
    }
    this.snapshots.push({ container, slots });
  }

  /** 逆序恢复所有快照 */
  rollback(): void {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const { container, slots } = this.snapshots[i]!;
      for (let s = 0; s < container.capacity; s++) {
        container.setItem(s, slots[s]?.clone());
      }
    }
    this.snapshots = [];
  }
}