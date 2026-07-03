import type { Container } from "@minecraft/server";
import { restoreContainerSnapshot, snapshotContainer, type SlotSnapshot } from "./ContainerSnapshot";

interface TargetSnapshot {
  containerId: string;
  container: Container;
  snapshot: SlotSnapshot[];
}

export interface JournalResult {
  ok: boolean;
  error?: string;
}

/**
 * 记录一次输入槽分拣过程中被写入的目标容器快照。
 *
 * 该事务只在当前 tick 内有效，不跨重启持久化。
 */
export class MoveJournal {
  private readonly targets: TargetSnapshot[] = [];
  private readonly seen = new Set<string>();

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
   * 将所有已记录目标容器按相反顺序恢复。
   */
  rollback(): JournalResult {
    const errors: string[] = [];
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
