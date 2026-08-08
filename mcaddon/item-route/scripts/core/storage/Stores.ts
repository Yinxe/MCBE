// ─── 存储抽象（index 不再持久化）：仓库 meta / 容器注册表 / 统计 ──
// 索引（byItem/族桶）是**纯运行时派生缓存**：权威源 = 容器真实内容，
// **不落盘**（激活时全容积量扫描重建，卸载即弃）。故这里没有 IndexStore ——
// 容器结构持久化仍走注册表（ir2:c），统计走 StatsStore（ir2:cst）。
import { InMemoryKeyValueStore, type KeyValueStore } from "./KeyValueStore";
import type { ContainerId, PlayerName, WarehouseId } from "../model/types";
import type { Member, WarehouseArea, WarehouseSettings } from "../model/Warehouse";

// ── 快照结构（可序列化） ─────────────────────────────────
/** 仓库 meta 快照：不含容器（容器注册表是每容器一条键 + 每仓 cids 索引，mc 层维护） */
export interface WarehouseSnapshot {
  id: WarehouseId;
  displayName: string;
  ownerName: PlayerName;
  members: Member[];
  area: WarehouseArea;
  settings: WarehouseSettings;
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

/** 仓库 meta 仓储：list/load/save/remove（单键 generation，防崩溃半截） */
export interface WarehouseStore {
  list(): WarehouseSnapshot[];
  load(id: WarehouseId): WarehouseSnapshot | undefined;
  save(snapshot: WarehouseSnapshot): void;
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

export class InMemoryStatsStore implements StatsStore {
  constructor(private kv: KeyValueStore = new InMemoryKeyValueStore()) {}

  loadContainer(containerId: ContainerId): ContainerStatsData | undefined {
    return this.kv.read<ContainerStatsData>(key("cst", containerId));
  }

  saveContainer(containerId: ContainerId, stats: ContainerStatsData): boolean {
    this.kv.write(key("cst", containerId), stats);
    return true;
  }

  removeContainer(containerId: ContainerId): void {
    this.kv.remove(key("cst", containerId));
  }
}
