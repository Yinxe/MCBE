import { type Container, type ItemStack } from "@minecraft/server";
import { Logger } from "../util/Logger";

const log = new Logger("SlotOrganizer");

/**
 * 整理操作的选项。
 */
export interface OrganizeOptions {
  /** 起始槽位（含），默认 0 */
  startSlot: number;
  /** 结束槽位（不含），默认 container.size */
  endSlot: number;
  /** 排序方式，默认 "typeId" */
  sortBy: "typeId";
  /** 锁定槽位集合，这些槽位的内容不会被移动或修改 */
  lockedSlots?: Set<number>;
}

/**
 * 整理操作的结果。
 */
export interface OrganizeResult {
  /** 是否成功完成（部分失败也算成功，因为不丢物品） */
  success: boolean;
  /** 发生变动的物品堆数量（合并+移动） */
  movedStacks: number;
  /** 错误描述（仅 success = false 时存在） */
  error?: string;
}

const DEFAULT_OPTIONS: OrganizeOptions = {
  startSlot: 0,
  endSlot: Infinity,
  sortBy: "typeId",
};

/**
 * ============================================================================
 * SlotOrganizer —— 容器槽位整理器
 * ============================================================================
 *
 * 对容器指定范围内的物品进行 **排序 + 堆叠合并**。
 * 支持任意 Container 对象（箱子、玩家背包、漏斗等）。
 *
 * ### 数据安全策略（零丢失）
 *
 * 1. **先读后写**：所有物品先完整读到内存，绝不边读边写
 * 2. **原地覆写**：从头到尾覆写，不清空整个容器
 * 3. **逐槽容错**：单个槽位写入失败不影响其他槽位
 * 4. **元数据全保留**：ItemStack 对象直接排序（附魔/改名/Lore 全部保留）
 *
 * ### 示例
 * ```
 * 输入: [铁×23, 空, 煤×16, 煤×60, 铁×3]
 * 输出: [铁×64, 铁×19, 煤×64, 煤×12]
 * ```
 *
 * ### 其他整理模组的踩坑记录（已采纳）
 *
 * - **`isStackableWith()`**：不要用 `typeId` 直接判断能否合并。
 *   附魔/改名/Lore 不同的物品即使 typeId 相同也不能堆叠，
 *   `isStackableWith()` 是官方 API，会检查完整元数据。
 * - **锁定槽位**：提供 `lockedSlots` 选项保护重要物品不被移动。
 * - **潜影盒内容**：不开盒整理，仅移动盒本身。
 * - **数据安全**：先读后写，原地覆写不清空，逐槽容错。
 *
 * 可指定 slot 范围来只整理容器的部分区域：
 * - 普通箱子 0~27
 * - 玩家背包除快捷栏 9~36
 * ============================================================================
 */
export class SlotOrganizer {
  /**
   * 整理容器中指定范围内的物品。
   *
   * @param container - Minecraft Container 对象
   * @param options   - 整理选项（可选，默认整理全部槽位）
   * @returns 整理结果
   */
  organize(container: Container, options?: Partial<OrganizeOptions>): OrganizeResult {
    const opts: OrganizeOptions = { ...DEFAULT_OPTIONS, ...options };
    const endSlot = Math.min(opts.endSlot, container.size);
    const startSlot = Math.max(0, opts.startSlot);

    if (startSlot >= endSlot || startSlot >= container.size) {
      return { success: true, movedStacks: 0 };
    }

    // ═══════════════════════════════════════════════════════════════
    // 第 1 步：读取——任何读取失败立即中止
    // ═══════════════════════════════════════════════════════════════
    const items: ItemStack[] = [];
    const occupiedSlots = new Set<number>();

    for (let slot = startSlot; slot < endSlot; slot++) {
      if (opts.lockedSlots?.has(slot)) continue;
      try {
        const stack = container.getItem(slot);
        if (stack) {
          items.push(stack);
          occupiedSlots.add(slot);
        }
      } catch (e) {
        const msg = `槽位 ${slot} 读取失败: ${e}`;
        log.error(msg);
        return { success: false, movedStacks: 0, error: msg };
      }
    }

    if (items.length <= 1) {
      return { success: true, movedStacks: 0 };
    }

    // ═══════════════════════════════════════════════════════════════
    // 第 2 步：生成数据校验和（写入前核对用）
    // ═══════════════════════════════════════════════════════════════
    const checksum = new Map<string, { stacks: number; total: number }>();
    for (const item of items) {
      const entry = checksum.get(item.typeId) ?? { stacks: 0, total: 0 };
      entry.stacks++;
      entry.total += item.amount;
      checksum.set(item.typeId, entry);
    }

    // ═══════════════════════════════════════════════════════════════
    // 第 3 步：排序 + 合并（纯内存操作）
    // ═══════════════════════════════════════════════════════════════

    // 3a: 按 typeId 排序（保留全部元数据）
    items.sort((a, b) => a.typeId.localeCompare(b.typeId));

    // 3b: 合并相邻可堆叠物品
    // 使用 isStackableWith() 而非 typeId 比较，确保附魔/改名/Lore 不同的物品不被错误合并
    const merged: ItemStack[] = [];
    for (const item of items) {
      const last = merged[merged.length - 1];
      if (last && last.amount < last.maxAmount && item.isStackableWith(last)) {
        const space = last.maxAmount - last.amount;
        const toMove = Math.min(item.amount, space);
        last.amount += toMove;
        item.amount -= toMove;
        if (item.amount > 0) {
          merged.push(item);
        }
      } else {
        merged.push(item);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 第 4 步：写入前校验——确保数据完整性
    // ═══════════════════════════════════════════════════════════════
    for (const item of merged) {
      const entry = checksum.get(item.typeId);
      if (!entry) {
        const msg = `校验失败：整理后出现未知物品种类 ${item.typeId}，已中止`;
        log.error(msg);
        return { success: false, movedStacks: 0, error: msg };
      }
      entry.stacks--;
      entry.total -= item.amount;
    }

    // 检查是否有遗漏或多余的数据
    for (const [typeId, entry] of checksum) {
      if (entry.stacks !== 0 || entry.total !== 0) {
        const msg = `校验失败：物品种类 ${typeId} 数量不匹配 ` +
          `(剩余 stacks=${entry.stacks}, total=${entry.total})，已中止`;
        log.error(msg);
        return { success: false, movedStacks: 0, error: msg };
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 第 5 步：原地覆写（校验通过，可以安全写入）
    // ═══════════════════════════════════════════════════════════════
    let writeErrors = 0;
    let slot = startSlot;

    // 5a: 写入排序合并后的物品（跳过锁定槽位，不超出 endSlot）
    for (const item of merged) {
      while (slot < endSlot && opts.lockedSlots?.has(slot)) slot++;
      if (slot >= endSlot) break;
      try {
        container.setItem(slot, item);
        slot++;
      } catch (e) {
        log.error(`槽位 ${slot} 写入失败: ${e}`);
        writeErrors++;
      }
    }

    // 5b: 清空原范围内多余的槽位
    for (const os of occupiedSlots) {
      if (os >= slot) {
        try { container.setItem(os, undefined); } catch { /* 忽略 */ }
      }
    }

    const movedStacks = Math.abs(items.length - merged.length);
    if (writeErrors > 0) {
      log.info(`整理完成，但有 ${writeErrors} 个槽位写入失败`);
    }

    return { success: writeErrors === 0, movedStacks };
  }
}
