import type { Container, ItemStack } from "@minecraft/server";
import { restoreContainerSnapshot, snapshotContainer, type SlotSnapshot } from "./ContainerSnapshot";

interface TargetSnapshot {
  containerId: string;
  container: Container;
  snapshot: SlotSnapshot[];
}

interface SourceSnapshot {
  containerId: string;
  container: Container;
  slot: number;
  item?: ItemStack;
}

export interface JournalResult {
  ok: boolean;
  error?: string;
}

/**
 * 记录一次输入槽分拣过程中被写入的源/目标容器快照。
 *
 * 使用 transferItem 时，源容器和目标容器都会被修改，
 * 因此需要同时记录两端的快照以便回滚。
 *
 * 该事务只在当前 tick 内有效，不跨重启持久化。
 */
export class MoveJournal {
  private readonly targets: TargetSnapshot[] = [];
  private readonly seen = new Set<string>();
  private source?: SourceSnapshot;

  /**
   * 在目标容器首次被写入前记录完整快照。
   * @param containerId - 目标容器 ID
   * @param container - 目标容器运行时引用
   */
  snapshotTarget(containerId: string, container: Container): void {
    if (this.seen.has(containerId)) return;
    this.seen.add(containerId);
    this.targets.push({ containerId, container, snapshot: snapshotContainer(container) });
  }

  /**
   * 在 transferItem 修改源容器前记录源槽位的快照。
   * @param containerId - 源容器 ID
   * @param container - 源容器对象
   * @param slot - 源槽位索引
   */
  snapshotSource(containerId: string, container: Container, slot: number): void {
    if (this.source) return; // 只记录一次
    this.source = { containerId, container, slot, item: container.getItem(slot)?.clone() };
  }

  /**
   * 将所有已记录的目标容器按相反顺序恢复，然后恢复源容器。
   */
  rollback(): JournalResult {
    const errors: string[] = [];

    // 恢复源容器
    if (this.source) {
      try {
        this.source.container.setItem(this.source.slot, this.source.item);
      } catch (error) {
        errors.push(`源容器 ${this.source.containerId} 恢复失败: ${error}`);
      }
    }

    // 恢复目标容器（逆序）
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const target = this.targets[i];
      const result = restoreContainerSnapshot(target.container, target.snapshot);
      if (!result.ok) {
        errors.push(`${target.containerId}: ${result.error ?? "恢复失败"}`);
      }
    }

    if (errors.length > 0) return { ok: false, error: errors.join("; ") };
    return { ok: true };
  }
}
