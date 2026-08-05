// ─── 混乱度模块（v1 smartwarehouse MessinessScore 模型） ──
// 单容器混乱度：总分 0-1 加权 = 顺序逆序对(70%) + 未满堆叠(30%)。
//   · 顺序分：非空序列相邻逆序对占比（一个错位只影响相邻，不级联拉满）；
//   · 堆叠分：同种物品 ≥2 组未满堆叠才计未优化。非空槽 ≤1 时总分 0（纯净）。
// shouldAutoSort 用 `> threshold`（threshold 为 0-1），与 v1 onDeposit 语义一致。
// 混乱度与统计共享 `scanContainer` 单趟扫描（messinessFromScan 吃扫描结果）。
//
// 注意：v1 的**容器整理**（槽位排序 + 合并可堆叠堆）在 OrganizeService.organizeContainer
// 实现（单容器，不跨容器）；本模块只负责混乱度评分与自动整理阈值判定。
import type { Container } from "../model/Container";
import type { ItemId } from "../model/types";
import { scanContainer, type ContainerScanResult } from "../model/ContainerScan";

/** 混乱度评分分解（v1 smartwarehouse MessinessScore） */
export interface MessinessScore {
  /** 总分 0-1，越高越乱 */
  total: number;
  /** 顺序评分（权重 70%）：相邻逆序对占比 */
  order: number;
  /** 堆叠评分（权重 30%）：未充分堆叠占比 */
  stack: number;
  /** 最后一个非空槽索引 + 1（排序用分母） */
  effectiveSlots: number;
  /** 相邻逆序对数 */
  disorderSlots: number;
  /** 非空槽位数 */
  nonEmptySlots: number;
  /** 未优化（同种 ≥2 组未满堆叠）的堆叠数 */
  suboptimalStacks: number;
}

export class Organizer {
  /**
   * 容器混乱度（v1 smartwarehouse 模型，总分 0-1）。
   * - 顺序分（70%）：非空物品序列的相邻逆序对占比——只统计相邻关系，不级联。
   * - 堆叠分（30%）：同种物品有 2 组及以上未满堆叠才记入未优化（1 组未满属正常使用）。
   */
  messiness(container: Container): MessinessScore {
    return this.messinessFromScan(scanContainer(container));
  }

  /**
   * 基于扫描结果计算混乱度——与统计维护（StatsService.updateFromScan）共享同一趟
   * scanContainer 扫描，避免各消费方各自遍历容器（路由成功后"混乱度检查 + 统计"用）。
   */
  messinessFromScan(scan: ContainerScanResult): MessinessScore {
    const items = scan.items;
    const nonEmptySlots = items.length;
    const effectiveSlots = scan.lastNonEmptySlot >= 0 ? scan.lastNonEmptySlot + 1 : 0;
    if (nonEmptySlots <= 1) {
      return { total: 0, order: 0, stack: 0, effectiveSlots, disorderSlots: 0, nonEmptySlots, suboptimalStacks: 0 };
    }
    // 顺序评分（70%）——相邻逆序对，一个错位只影响相邻关系，不级联拉满
    // 例：[A,C,B,D] → 仅 C>B 一对逆序 → 1/3 × 0.7 = 0.23
    let inversions = 0;
    for (let i = 0; i < items.length - 1; i++) {
      if (items[i]!.itemId.localeCompare(items[i + 1]!.itemId) > 0) inversions++;
    }
    const maxInversions = Math.max(1, items.length - 1);
    const order = (inversions / maxInversions) * 0.7;
    // 堆叠评分（30%）——同种 ≥2 组未满堆叠记入未优化
    const groups = new Map<ItemId, { stacks: number; nonFull: number }>();
    for (const item of items) {
      const g = groups.get(item.itemId) ?? { stacks: 0, nonFull: 0 };
      g.stacks++;
      if (item.amount < item.maxStackSize) g.nonFull++;
      groups.set(item.itemId, g);
    }
    let suboptimalStacks = 0;
    for (const g of groups.values()) {
      if (g.nonFull >= 2) suboptimalStacks += g.nonFull;
    }
    const stack = nonEmptySlots > 0 ? (suboptimalStacks / nonEmptySlots) * 0.3 : 0;
    const total = Math.min(1, order + stack);
    return { total, order, stack, effectiveSlots, disorderSlots: inversions, nonEmptySlots, suboptimalStacks };
  }

  /** 容器混乱度总分 0-1（v1 模型），供自动整理阈值判定 */
  chaosScore(container: Container): number {
    return this.messiness(container).total;
  }

  shouldAutoSort(container: Container, threshold: number): boolean {
    return this.chaosScore(container) > threshold;
  }

  /** 基于扫描结果直接判定是否需自动整理（免二次扫描） */
  shouldAutoSortFromScan(scan: ContainerScanResult, threshold: number): boolean {
    return this.messinessFromScan(scan).total > threshold;
  }
}
