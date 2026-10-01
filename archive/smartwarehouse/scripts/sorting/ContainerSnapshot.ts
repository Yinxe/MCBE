import type { Container, ItemStack } from "@minecraft/server";

export interface SlotSnapshot {
  slot: number;
  item?: ItemStack;
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
}

/**
 * 克隆容器指定槽位范围的当前物品状态。
 *
 * @param container - 目标容器
 * @param startSlot - 起始槽位，默认 0
 * @param endSlot - 结束槽位（不含），默认容器大小
 * @returns 可用于回滚的槽位快照
 */
export function snapshotContainer(container: Container, startSlot = 0, endSlot = container.size): SlotSnapshot[] {
  const result: SlotSnapshot[] = [];
  const end = Math.min(endSlot, container.size);
  for (let slot = Math.max(0, startSlot); slot < end; slot++) {
    const item = container.getItem(slot);
    result.push({ slot, item: item?.clone() });
  }
  return result;
}

/**
 * 将容器恢复到给定快照。
 *
 * @param container - 目标容器
 * @param snapshot - 之前通过 snapshotContainer 创建的快照
 * @returns 恢复是否成功
 */
export function restoreContainerSnapshot(container: Container, snapshot: SlotSnapshot[]): RestoreResult {
  const errors: string[] = [];
  for (const entry of snapshot) {
    try {
      container.setItem(entry.slot, entry.item?.clone());
    } catch (error) {
      errors.push(`槽位 ${entry.slot} 恢复失败: ${error}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, error: errors.join("; ") };
  }
  return { ok: true };
}
