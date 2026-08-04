// ─── 索引仓储：脏标记批量落盘 + 1MB 降级（overwrite + hash 写后验） ──
import type { ShardStore } from "./ShardStore";
import type { IndexSnapshotData, IndexStore } from "../../core/storage/Stores";
import type { WarehouseId } from "../../core/model/types";

const indexKey = (id: WarehouseId): string => `ir2:idx:${id}`;

export class McIndexStore implements IndexStore {
  private dirty = new Map<WarehouseId, IndexSnapshotData>();

  constructor(private readonly shards: ShardStore) {}

  load(id: WarehouseId): IndexSnapshotData | undefined {
    return this.shards.read<IndexSnapshotData>(indexKey(id));
  }

  save(id: WarehouseId, snapshot: IndexSnapshotData): void {
    this.shards.write(indexKey(id), snapshot, "overwrite");
  }

  remove(id: WarehouseId): void {
    this.dirty.delete(id);
    this.shards.remove(indexKey(id));
  }

  /** 标记脏：路由热路径零 DP 写，仅内存 */
  markDirty(id: WarehouseId, snapshot: IndexSnapshotData): void {
    this.dirty.set(id, snapshot);
  }

  hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  /** 批量落盘全部脏项；返回失败数（1MB 超限项保留脏标记，自动恢复） */
  flush(): number {
    let failed = 0;
    for (const [id, snapshot] of this.dirty) {
      if (this.shards.write(indexKey(id), snapshot, "overwrite")) {
        this.dirty.delete(id);
      } else {
        failed++;
      }
    }
    return failed;
  }
}