import { system, type Container, type ItemStack } from "@minecraft/server";
import type { ContainerId } from "../types";
import { Logger } from "../util/Logger";

const log = new Logger("SlotOrganizer");

// ─── 公开类型 ──────────────────────────────────────────────────

export interface OrganizeOptions {
  startSlot: number;
  endSlot: number;
  sortBy: "typeId";
  lockedSlots?: Set<number>;
}

export interface OrganizeResult {
  success: boolean;
  movedStacks: number;
  beforeStacks: number;
  afterStacks: number;
  beforeTypes: number;
  afterTypes: number;
  perType: Record<string, { stacks: number; total: number }>;
  totalSlots: number;
  usedSlots: number;
  usagePercent: number;
  error?: string;
  /** 整理前后的混乱度评分（仅 analyze/organize 时有效） */
  messiness?: MessinessScore;
}

/**
 * 容器分析结果（Phase 1 的输出，可传入 apply 执行写入）。
 */
export interface ContainerAnalysis {
  /** 原始读取的所有物品（排序前） */
  rawItems: ItemStack[];
  /** 排序+合并后的物品 */
  sortedItems: ItemStack[];
  /** 读取范围内有物品的槽位 */
  occupiedSlots: Set<number>;
  /** 读取范围起始 */
  startSlot: number;
  /** 读取范围结束 */
  endSlot: number;
  /** 校验和：typeId → { stacks, total } */
  checksum: Map<string, { stacks: number; total: number }>;
  /** 混乱度评分 */
  messiness: MessinessScore;
}

/**
 * 混乱度评分（含权重分解）。
 */
export interface MessinessScore {
  /** 总分 0-1，越高越乱 */
  total: number;
  /** 顺序评分 0-1（权重 70%） */
  order: number;
  /** 堆叠评分 0-1（权重 30%） */
  stack: number;
  /** 总有效槽位数（排序用的分母） */
  effectiveSlots: number;
  /** 乱序槽位数 */
  disorderSlots: number;
  /** 非空槽位数 */
  nonEmptySlots: number;
  /** 未优化堆叠数 */
  suboptimalStacks: number;
}

const DEFAULT_OPTIONS: OrganizeOptions = {
  startSlot: 0,
  endSlot: Infinity,
  sortBy: "typeId",
};

// ─── 内部工具 ──────────────────────────────────────────────────

function buildPerType(stacks: ItemStack[]): Record<string, { stacks: number; total: number }> {
  const map: Record<string, { stacks: number; total: number }> = {};
  for (const s of stacks) {
    const e = map[s.typeId] ?? { stacks: 0, total: 0 };
    e.stacks++;
    e.total += s.amount;
    map[s.typeId] = e;
  }
  return map;
}

/**
 * ============================================================================
 * SlotOrganizer —— 容器槽位整理器（三段式 API）
 * ============================================================================
 *
 * 使用流程：
 * ```
 * const org = new SlotOrganizer();
 * const analysis = org.analyze(container);   // Phase 1: 读取+排序+评分
 * if (analysis.messiness.total > 0.3)        // 判断是否需要整理
 *   org.apply(container, analysis);          // Phase 2: 写入
 * ```
 *
 * 或一步到位：
 * ```
 * const result = org.organize(container);    // analyze + apply
 * ```
 * ============================================================================
 */
/** 容器锁安全网超时 tick */
const LOCK_SAFETY_TICKS = 100;

export class SlotOrganizer {
  /** 容器锁：containerId → 过期 tick（0 = 未锁定） */
  private readonly locks = new Map<ContainerId, number>();

  // ─── 锁管理 ──────────────────────────────────────────────────

  /** 检查容器是否被锁定（分拣引擎跳过已锁定容器） */
  isLocked(containerId: ContainerId): boolean {
    const expiry = this.locks.get(containerId) ?? 0;
    return system.currentTick < expiry;
  }

  /** 尝试获取容器写锁 */
  tryLock(containerId: ContainerId): boolean {
    if (this.isLocked(containerId)) return false;
    this.locks.set(containerId, system.currentTick + LOCK_SAFETY_TICKS);
    return true;
  }

  /** 释放容器写锁 */
  unlock(containerId: ContainerId): void {
    this.locks.set(containerId, 0);
  }

  /**
   * 分拣引擎向目标容器放入物品后调用。
   * 计算混乱度，超过阈值则自动整理。
   *
   * @param threshold - 混乱度阈值（0-1），0 表示关闭自动整理
   * @returns 是否执行了整理
   */
  onDeposit(container: Container, containerId: ContainerId, threshold: number): boolean {
    if (threshold <= 0) return false;

    try {
      const m = this.calculateMessiness(container);
      log.info(
        `onDeposit ${containerId}: messiness=${(m.total * 100).toFixed(0)}% ` +
        `(order=${(m.order * 100).toFixed(0)}% stack=${(m.stack * 100).toFixed(0)}%) ` +
        `threshold=${(threshold * 100).toFixed(0)}%`
      );

      if (m.total <= threshold) {
        log.info(`onDeposit ${containerId}: messiness below threshold, skip organize`);
        return false;
      }

      if (!this.tryLock(containerId)) {
        log.info(`onDeposit ${containerId}: lock busy, skip organize`);
        return false;
      }

      try {
        log.info(`onDeposit ${containerId}: organizing...`);
        const analysis = this.analyze(container);
        const result = this.apply(container, analysis);
        if (result.success) {
          log.info(`onDeposit ${containerId}: organize done, moved ${result.movedStacks} stacks`);
        } else {
          log.error(`onDeposit ${containerId}: organize failed: ${result.error}`);
        }
        return result.success;
      } finally {
        this.unlock(containerId);
      }
    } catch (e) {
      log.error(`onDeposit ${containerId}: error: ${e}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 混乱度评分（独立使用，不修改容器）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 计算容器指定范围的混乱度评分。
   *
   * **评分模型**（总分 0-1，越高越乱）：
   *
   * 顺序权重 70%：比较实际排列与理想排序（typeId 升序）的差异。
   *   - 有效范围 = 最后一个非空槽位索引 + 1
   *   - 逐个位置对比实际物品与理想物品，统计乱序槽位数
   *   - 范围内空格也增加乱序
   *   - 得分 = disorderSlots / effectiveSlots × 0.7
   *
   * 堆叠权重 30%：检测未充分堆叠的同种物品。
   *   - 某种物品有 2 组及以上未满堆叠 → 记入未优化
   *   - 只有 1 组未满堆叠不记（正常使用状态）
   *   - 得分 = suboptimalStacks / nonEmptySlots × 0.3
   */
  calculateMessiness(container: Container, options?: Partial<OrganizeOptions>): MessinessScore {
    const opts: OrganizeOptions = { ...DEFAULT_OPTIONS, ...options };
    const endSlot = Math.min(opts.endSlot, container.size);
    const startSlot = Math.max(0, opts.startSlot);

    // 读取物品
    const items: ItemStack[] = [];
    const slotTypes: (string | undefined)[] = [];
    let lastNonEmptySlot = -1;

    for (let slot = startSlot; slot < endSlot; slot++) {
      if (opts.lockedSlots?.has(slot)) continue;
      try {
        const stack = container.getItem(slot);
        slotTypes.push(stack?.typeId);
        if (stack) {
          items.push(stack);
          lastNonEmptySlot = slot;
        }
      } catch {
        slotTypes.push(undefined);
      }
    }

    const nonEmptySlots = items.length;
    const effectiveSlots = lastNonEmptySlot - startSlot + 1;

    if (nonEmptySlots <= 1) {
      return {
        total: 0, order: 0, stack: 0,
        effectiveSlots, disorderSlots: 0,
        nonEmptySlots, suboptimalStacks: 0,
      };
    }

    // ── 顺序评分（70%） ──
    // 构建理想序列：排序后的 typeId + padding
    const sortedTypes = [...items].sort((a, b) => a.typeId.localeCompare(b.typeId)).map((i) => i.typeId);

    let disorderSlots = 0;
    let idealIdx = 0;
    for (let i = 0; i < effectiveSlots; i++) {
      const actual = slotTypes[i];
      if (actual && idealIdx < sortedTypes.length && actual === sortedTypes[idealIdx]) {
        idealIdx++;
      } else {
        disorderSlots++;
      }
    }
    // 剩余未匹配的理想条目也计入乱序
    disorderSlots += Math.max(0, sortedTypes.length - idealIdx);
    // 上限不超过 effectiveSlots
    disorderSlots = Math.min(disorderSlots, effectiveSlots);

    const order = effectiveSlots > 0 ? (disorderSlots / effectiveSlots) * 0.7 : 0;

    // ── 堆叠评分（30%） ──
    // 按 typeId 分组统计堆叠情况
    const typeGroups = new Map<string, { stacks: number; nonFull: number }>();
    for (const item of items) {
      let g = typeGroups.get(item.typeId);
      if (!g) {
        g = { stacks: 0, nonFull: 0 };
        typeGroups.set(item.typeId, g);
      }
      g.stacks++;
      if (item.amount < item.maxAmount) g.nonFull++;
    }

    let suboptimalStacks = 0;
    for (const g of typeGroups.values()) {
      // 同种物品有 2+ 组未满堆叠才记入未优化
      if (g.nonFull >= 2) suboptimalStacks += g.nonFull;
    }

    const stack = nonEmptySlots > 0 ? (suboptimalStacks / nonEmptySlots) * 0.3 : 0;
    const total = Math.min(1, order + stack);

    return { total, order, stack, effectiveSlots, disorderSlots, nonEmptySlots, suboptimalStacks };
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 1：分析（只读，不写）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 分析容器：读取物品 → 排序 → 合并 → 评分。
   * 纯内存操作，不修改容器。
   *
   * @returns 容器分析结果（可传入 apply 执行写入，或仅用于评分）
   */
  analyze(container: Container, options?: Partial<OrganizeOptions>): ContainerAnalysis {
    const opts: OrganizeOptions = { ...DEFAULT_OPTIONS, ...options };
    const endSlot = Math.min(opts.endSlot, container.size);
    const startSlot = Math.max(0, opts.startSlot);

    const rawItems: ItemStack[] = [];
    const occupiedSlots = new Set<number>();

    for (let slot = startSlot; slot < endSlot; slot++) {
      if (opts.lockedSlots?.has(slot)) continue;
      try {
        const stack = container.getItem(slot);
        if (stack) {
          rawItems.push(stack);
          occupiedSlots.add(slot);
        }
      } catch (e) {
        throw new Error(`槽位 ${slot} 读取失败: ${e}`);
      }
    }

    // 排序
    const sorted = [...rawItems].sort((a, b) => a.typeId.localeCompare(b.typeId));

    // 合并相邻可堆叠
    const merged: ItemStack[] = [];
    for (const item of sorted) {
      const last = merged[merged.length - 1];
      if (last && last.amount < last.maxAmount && item.isStackableWith(last)) {
        const space = last.maxAmount - last.amount;
        const toMove = Math.min(item.amount, space);
        last.amount += toMove;
        item.amount -= toMove;
        if (item.amount > 0) merged.push(item);
      } else {
        merged.push(item);
      }
    }

    // 校验和
    const checksum = new Map<string, { stacks: number; total: number }>();
    for (const item of rawItems) {
      const e = checksum.get(item.typeId) ?? { stacks: 0, total: 0 };
      e.stacks++;
      e.total += item.amount;
      checksum.set(item.typeId, e);
    }

    const messiness = this.calculateMessiness(container, options);

    return { rawItems, sortedItems: merged, occupiedSlots, startSlot, endSlot, checksum, messiness };
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 2：写入（基于 analyze 的结果）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 将 analyze 阶段的分析结果写入容器。
   * 写入前会通过 checksum 校验数据完整性。
   *
   * @returns 整理结果
   */
  apply(container: Container, analysis: ContainerAnalysis): OrganizeResult {
    const { sortedItems, occupiedSlots, checksum, startSlot, endSlot, rawItems } = analysis;

    // ── 校验 ──
    const verify = new Map(checksum);
    for (const item of sortedItems) {
      const entry = verify.get(item.typeId);
      if (!entry) {
        return this.makeError(`校验失败：出现未知种类 ${item.typeId}`, rawItems, sortedItems, endSlot - startSlot, occupiedSlots.size);
      }
      entry.stacks--;
      entry.total -= item.amount;
    }
    for (const [typeId, entry] of verify) {
      if (entry.stacks !== 0 || entry.total !== 0) {
        return this.makeError(
          `校验失败：${typeId} 数量不匹配(stacks=${entry.stacks}, total=${entry.total})`,
          rawItems, sortedItems, endSlot - startSlot, occupiedSlots.size
        );
      }
    }

    // ── 写入 ──
    let writeErrors = 0;
    let slot = startSlot;

    for (const item of sortedItems) {
      if (slot >= endSlot) break;
      try {
        container.setItem(slot, item);
        slot++;
      } catch (e) {
        log.error(`槽位 ${slot} 写入失败: ${e}`);
        writeErrors++;
      }
    }

    for (const os of occupiedSlots) {
      if (os >= slot) {
        try { container.setItem(os, undefined); } catch { /* 忽略 */ }
      }
    }

    const beforeStacks = rawItems.length;
    const afterStacks = sortedItems.length;
    const beforeTypes = new Set(rawItems.map((i) => i.typeId)).size;
    const afterTypes = new Set(sortedItems.map((i) => i.typeId)).size;

    return {
      success: writeErrors === 0,
      movedStacks: beforeStacks - afterStacks,
      beforeStacks, afterStacks, beforeTypes, afterTypes,
      perType: buildPerType(sortedItems),
      totalSlots: endSlot - startSlot,
      usedSlots: occupiedSlots.size,
      usagePercent: endSlot > startSlot ? Math.round((occupiedSlots.size / (endSlot - startSlot)) * 100) : 0,
      error: writeErrors > 0 ? `${writeErrors} 个槽位写入失败` : undefined,
      messiness: analysis.messiness,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 快捷方法：analyze + apply
  // ═══════════════════════════════════════════════════════════════

  organize(container: Container, options?: Partial<OrganizeOptions>): OrganizeResult {
    const analysis = this.analyze(container, options);
    return this.apply(container, analysis);
  }

  // ─── 内部辅助 ────────────────────────────────────────────────

  private makeError(
    msg: string, raw: ItemStack[], sorted: ItemStack[],
    totalSlots: number, usedSlots: number
  ): OrganizeResult {
    return {
      success: false, movedStacks: 0, error: msg,
      beforeStacks: raw.length, afterStacks: sorted.length,
      beforeTypes: new Set(raw.map((i) => i.typeId)).size,
      afterTypes: new Set(sorted.map((i) => i.typeId)).size,
      perType: buildPerType(raw),
      totalSlots, usedSlots,
      usagePercent: totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0,
    };
  }
}
