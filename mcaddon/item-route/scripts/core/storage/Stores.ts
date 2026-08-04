// ─── 仓库/索引/统计仓储接口（core 定义，mc 层实现 DP 分片） ──
import { InMemoryKeyValueStore, type KeyValueStore } from "./KeyValueStore";
import type { ContainerId, PlayerId, WarehouseId } from "../model/types";
import type { Member, WarehouseArea, WarehouseSettings } from "../model/Warehouse";

// ── 快照结构（可序列化） ─────────────────────────────────
export interface WarehouseSnapshot {
  id: WarehouseId;
  displayName: string;
  ownerId: PlayerId;
  members: Member[];
  area: WarehouseArea;
  settings: WarehouseSettings;
  containerIds: ContainerId[];
}

export interface IndexSnapshotData {
  version: number;
  byItem: Record<string, { single: ContainerId[]; multi: ContainerId[] }>;
  containerItems: Record<ContainerId, string[]>;
  singleBindings: Record<ContainerId, string>;
}

export interface StatsSnapshotData {
  warehouseId: WarehouseId;
  containers: Record<ContainerId, unknown>;
  warehouse: unknown;
}

export interface WarehouseStore {
  list(): WarehouseSnapshot[];
  load(id: WarehouseId): WarehouseSnapshot | undefined;
  save(snapshot: WarehouseSnapshot): void;
  remove(id: WarehouseId): void;
}

export interface IndexStore {
  load(id: WarehouseId): IndexSnapshotData | undefined;
  save(id: WarehouseId, snapshot: IndexSnapshotData): void;
  remove(id: WarehouseId): void;
}

export interface StatsStore {
  load(id: WarehouseId): StatsSnapshotData | undefined;
  save(id: WarehouseId, snapshot: StatsSnapshotData): void;
  remove(id: WarehouseId): void;
}

// ── 内存实现（测试用） ───────────────────────────────────
const key = (prefix: string, id: string): string => `${prefix}:${id}`;

export class InMemoryWarehouseStore implements WarehouseStore {
  constructor(private kv: KeyValueStore = new InMemoryKeyValueStore()) {}

  list(): WarehouseSnapshot[] {
    return Object.values(this.kv.read<Record<string, WarehouseSnapshot>>("warehouses") ?? {});
  }

  load(id: WarehouseId): WarehouseSnapshot | undefined {
    return this.list().find((w) => w.id === id);
  }

  save(snapshot: WarehouseSnapshot): void {
    const all = this.kv.read<Record<string, WarehouseSnapshot>>("warehouses") ?? {};
    all[snapshot.id] = snapshot;
    this.kv.write("warehouses", all);
  }

  remove(id: WarehouseId): void {
    const all = this.kv.read<Record<string, WarehouseSnapshot>>("warehouses") ?? {};
    delete all[id];
    this.kv.write("warehouses", all);
  }
}

export class InMemoryIndexStore implements IndexStore {
  constructor(private kv: KeyValueStore = new InMemoryKeyValueStore()) {}

  load(id: WarehouseId): IndexSnapshotData | undefined {
    return this.kv.read(key("index", id));
  }

  save(id: WarehouseId, snapshot: IndexSnapshotData): void {
    this.kv.write(key("index", id), snapshot);
  }

  remove(id: WarehouseId): void {
    this.kv.remove(key("index", id));
  }
}

export class InMemoryStatsStore implements StatsStore {
  constructor(private kv: KeyValueStore = new InMemoryKeyValueStore()) {}

  load(id: WarehouseId): StatsSnapshotData | undefined {
    return this.kv.read(key("stats", id));
  }

  save(id: WarehouseId, snapshot: StatsSnapshotData): void {
    this.kv.write(key("stats", id), snapshot);
  }

  remove(id: WarehouseId): void {
    this.kv.remove(key("stats", id));
  }
}
