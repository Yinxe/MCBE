// ─── 主手选择策略（core 层） ────────────────────────────
// 纯逻辑：主手清空可行性与槽位展示名。UI 标签的带色渲染在 mc 层。

/** 判定主手是否可清空：存在非主手空槽时才能把主手物品移走 */
export function canClearMainhand<T>(items: ReadonlyArray<T | null>, handSlot: number): boolean {
  for (let i = 0; i < items.length; i++) {
    if (i !== handSlot && !items[i]) return true;
  }
  return false;
}

/** 槽位展示名：热栏 (0-8) / 背包 (9+) */
export function slotLabel(slotIndex: number): string {
  return slotIndex < 9 ? `热栏${slotIndex + 1}` : `背包${slotIndex + 1}`;
}