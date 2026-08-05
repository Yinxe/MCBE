// ─── 仓库/索引/统计仓储接口（core 定义，mc 层实现 DP 分片） ──
// 这是持久化边界：core 只定义**可序列化快照结构 + 接口**（零 MC 依赖），
// mc 层（scripts/mc/storage/）用 DP 实现。
//   · WarehouseStore —— 仓库快照（meta + containerIds 引用）
//   · IndexStore     —— 索引快照（IndexSnapshotData，对应 ItemIndex.serialize）
//   · StatsStore     —— 统计快照
// 快照必须是纯 JSON（无函数/Map/Set），才能进出 DP（JSON.stringify/parse）。
// InMemory*Store 供 node 单测；真实 DP 版见 McWarehouseStore/McIndexStore/McStatsStore。
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

/** 容器统计快照（纯 JSON；与 ContainerStats 结构兼容，供 DP 存取） */
export interface ContainerStatsData {
  containerId: ContainerId;
  role: string;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  isWarning: boolean;
  byType: Record<string, number>;
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

/** 统计存储：**每容器一条**（v1 方案；容器 ID 全局唯一，键无需仓库前缀） */
export interface StatsStore {
  loadContainer(containerId: ContainerId): ContainerStatsData | undefined;
  /** 返回是否写入成功（供 flush 失败重试） */
  saveContainer(containerId: ContainerId, stats: ContainerStatsData): boolean;
  removeContainer(containerId: ContainerId): void;
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

  loadContainer(containerId: ContainerId): ContainerStatsData | undefined {
    return this.kv.read(key("cstats", containerId));
  }

  saveContainer(containerId: ContainerId, stats: ContainerStatsData): boolean {
    this.kv.write(key("cstats", containerId), stats);
    return true;
  }

  removeContainer(containerId: ContainerId): void {
    this.kv.remove(key("cstats", containerId));
  }
}