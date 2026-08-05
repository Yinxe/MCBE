// ─── 容器扫描：单趟遍历产出统计 + 混乱度共同所需的数据 ──
// 目的：让"一次扫描"同时服务多个消费方——混乱度检查（Organizer.messinessFromScan）
// 与统计维护（StatsService.updateFromScan）都吃同一份 ContainerScanResult，
// 避免路由成功后的混乱度检查与统计各自再扫一遍容器。
import type { Container } from "./Container";
import type { ItemStack } from "./ItemStack";
import type { ItemId } from "./types";

/** 单趟扫描结果（一次遍历可同时供统计/混乱度/搜索分析） */
export interface ContainerScanResult {
  /** 所有非空物品（按槽位顺序） */
  items: ItemStack[];
  /** 每物品种类总数（itemId → amount 累加） */
  byType: Record<ItemId, number>;
  /** 非空槽位数 */
  usedSlots: number;
  /** 物品总数 */
  totalItems: number;
  /** 最后一个非空槽索引（无一非空为 -1） */
  lastNonEmptySlot: number;
}

/** 单趟扫描容器全部槽位；读失败槽位静默跳过（与适配层安全访问语义一致） */
export function scanContainer(container: Container): ContainerScanResult {
  const items: ItemStack[] = [];
  const byType: Record<ItemId, number> = {};
  let totalItems = 0;
  let lastNonEmptySlot = -1;
  for (let i = 0; i < container.capacity; i++) {
    const item = container.getItem(i);
    if (item === undefined) continue;
    items.push(item);
    lastNonEmptySlot = i;
    totalItems += item.amount;
    byType[item.itemId] = (byType[item.itemId] ?? 0) + item.amount;
  }
  return { items, byType, usedSlots: items.length, totalItems, lastNonEmptySlot };
}
