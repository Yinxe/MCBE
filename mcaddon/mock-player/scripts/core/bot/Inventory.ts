// ─── 背包纯逻辑（core 层零依赖，可 node 单测） ────────
// 按槽位索引数组视角的查找/计数/空位/边界——mc 层 MockBot 背包封装的地基。
// findFirstItemByPriority 语义对齐宝库工作流 findKeySlot（按优先级顺序取第一处）。

/** 单个槽位视图（undefined = 空槽）；数组下标即槽位 */
export type SlotView = { typeId: string; amount: number } | undefined;

/** 查找指定物品的所有槽位（空结果 = 背包没有该物品） */
export function findItemSlots(inv: SlotView[], typeId: string): number[] {
  const slots: number[] = [];
  for (let i = 0; i < inv.length; i++) {
    if (inv[i]?.typeId === typeId) slots.push(i);
  }
  return slots;
}

/** 按优先级顺序找第一个匹配物品的槽位（undefined = 都没有） */
export function findFirstItemByPriority(inv: SlotView[], typeIds: string[]): number | undefined {
  for (const typeId of typeIds) {
    const slot = findItemSlots(inv, typeId)[0];
    if (slot !== undefined) return slot;
  }
  return undefined;
}

/** 统计指定物品在背包中的总数量（跨槽合计） */
export function countItemTotal(inv: SlotView[], typeId: string): number {
  let total = 0;
  for (const item of inv) {
    if (item?.typeId === typeId) total += item.amount;
  }
  return total;
}

/** 找第一个空槽（undefined = 背包已满） */
export function findEmptySlot(inv: SlotView[]): number | undefined {
  for (let i = 0; i < inv.length; i++) {
    if (!inv[i]) return i;
  }
  return undefined;
}

/** 槽位是否在容器边界内 */
export function isValidSlot(inv: SlotView[], slot: number): boolean {
  return slot >= 0 && slot < inv.length;
}
