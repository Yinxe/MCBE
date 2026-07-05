import { Container, ItemStack } from "@minecraft/server";

/**
 * 容器槽位扫描结果 —— 一次遍历可同时供给统计、混乱度、搜索等分析。
 */
export interface SlotScanResult {
  /** 所有非空物品（按槽位顺序排列） */
  items: ItemStack[];
  /** 每个槽位的物品类型 ID（undefined = 空），用于顺序分析 */
  slotTypes: (string | undefined)[];
  /** 最后一个非空槽位的索引（无一非空时为 -1） */
  lastNonEmptySlot: number;
  /** 扫描范围内的总槽位数 */
  totalSlots: number;
  /** 有效范围（从 startSlot 到最后一个非空槽位），用于混乱度评分 */
  effectiveSlots: number;
  /** 已使用的槽位数 */
  usedSlots: number;
  /** 物品种类数 */
  uniqueTypes: number;
  /** 物品总数 */
  totalItems: number;
}

/**
 * 扫描容器的槽位范围，收集基础数据。
 *
 * 将"遍历 + getItem + 错误处理"抽象为一次调用，避免各处重复实现。
 * 返回的结果可同时用于容量统计（usedSlots/totalItems/uniqueTypes）
 * 和混乱度分析（items/slotTypes）。
 *
 * @param container - Minecraft 容器实例
 * @param options   - 扫描范围与排除配置
 */
export function scanContainerSlots(
  container: Container,
  options?: { startSlot?: number; endSlot?: number; lockedSlots?: Set<number> }
): SlotScanResult {
  const endSlot = Math.min(options?.endSlot ?? container.size, container.size);
  const startSlot = Math.max(options?.startSlot ?? 0, 0);
  const lockedSlots = options?.lockedSlots;

  const items: ItemStack[] = [];
  const slotTypes: (string | undefined)[] = [];
  let lastNonEmptySlot = -1;
  const uniqueTypeSet = new Set<string>();
  let totalItems = 0;

  for (let slot = startSlot; slot < endSlot; slot++) {
    if (lockedSlots?.has(slot)) continue;
    try {
      const stack = container.getItem(slot);
      slotTypes.push(stack?.typeId);
      if (stack) {
        items.push(stack);
        lastNonEmptySlot = slot;
        totalItems += stack.amount;
        uniqueTypeSet.add(stack.typeId);
      }
    } catch {
      slotTypes.push(undefined);
    }
  }

  return {
    items,
    slotTypes,
    lastNonEmptySlot,
    totalSlots: endSlot - startSlot,
    effectiveSlots: lastNonEmptySlot >= 0 ? lastNonEmptySlot - startSlot + 1 : 0,
    usedSlots: items.length,
    uniqueTypes: uniqueTypeSet.size,
    totalItems,
  };
}

/**
 * 从扫描结果计算容器容量统计。
 * 可直接使用 scanContainerSlots 的返回值，无需二次遍历。
 */
export function statsFromScan(
  scan: SlotScanResult,
  blockType: string,
  containerId: string,
  role: string
): {
  blockType: string;
  containerId: string;
  role: string;
  usedSlots: number;
  totalSlots: number;
  totalItems: number;
  uniqueTypes: number;
  isWarning: boolean;
} {
  return {
    blockType,
    containerId,
    role,
    usedSlots: scan.usedSlots,
    totalSlots: scan.totalSlots,
    totalItems: scan.totalItems,
    uniqueTypes: scan.uniqueTypes,
    isWarning: scan.totalSlots > 0 && scan.usedSlots / scan.totalSlots >= 0.9,
  };
}
