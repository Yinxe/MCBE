// ─── 索引仓储：脏标记批量落盘（overwrite + hash 写后验） ──
// 路由热路径的"写放大"消除层（v1「批量落盘避免每路由一写放大 DP IO」）：
//   · `markDirty(id, snapshot)` —— 只把最新索引快照放进内存 dirty Map（零 DP 写）。
//     路由每移动一次就 markDirty 一次，但只覆盖同一 key，不产生多次 DP 写。
//   · `flush()` —— 把全部脏项一次性落盘；成功后清脏。
//   · 落盘时机由装配层驱动：玩家离开 + 每 100 tick（McEventBridge）。
// 索引数据量可能较大（byItem/containerItems/singleBindings），ShardStore 会分包，
// 单 key 不超限；总量随存档无限制。
//
// 崩溃安全性：只 markDirty 不回写时，崩溃丢的是"本次会话的增量"；
// 启动时若版本不符/缺失由 ItemIndex 从容器全量重建（候选过期由策略侧 reconcile 惰性兜底），
// 不产生持久损坏。
import type { ShardStore } from "./ShardStore";
import type { IndexSnapshotData, IndexStore } from "../../core/storage/Stores";
import type { WarehouseId } from "../../core/model/types";

const indexKey = (id: WarehouseId): string => `ir2:idx:${id}`;

export class McIndexStore implements IndexStore {
  /** 脏项持**索引对象引用**，flush 时才序列化——路由热路径零拷贝（索引每轮都在变，延后序列化拿到最新态） */
  private dirty = new Map<WarehouseId, { serialize(): IndexSnapshotData }>();

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

  /** 标记脏：持索引引用，零 DP 写、零序列化（flush 时再序列化最新态） */
  markDirty(id: WarehouseId, index: { serialize(): IndexSnapshotData }): void {
    this.dirty.set(id, index);
  }

  hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  /** 批量落盘全部脏项（此刻才 serialize）；返回失败数（1MB 超限项保留脏标记，自动恢复） */
  flush(): number {
    let failed = 0;
    for (const [id, index] of this.dirty) {
      if (this.shards.write(indexKey(id), index.serialize(), "overwrite")) {
        this.dirty.delete(id);
      } else {
        failed++;
      }
    }
    return failed;
  }
}