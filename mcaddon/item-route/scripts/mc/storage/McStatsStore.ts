// ─── 统计仓储：写穿透（overwrite + hash） ──
import type { ShardStore } from "./ShardStore";
import type { StatsSnapshotData, StatsStore } from "../../core/storage/Stores";
import type { WarehouseId } from "../../core/model/types";

const statsKey = (id: WarehouseId): string => `ir2:st:${id}`;

export class McStatsStore implements StatsStore {
  constructor(private readonly shards: ShardStore) {}

  load(id: WarehouseId): StatsSnapshotData | undefined {
    return this.shards.read<StatsSnapshotData>(statsKey(id));
  }

  save(id: WarehouseId, snapshot: StatsSnapshotData): void {
    this.shards.write(statsKey(id), snapshot, "overwrite");
  }

  remove(id: WarehouseId): void {
    this.shards.remove(statsKey(id));
  }
}