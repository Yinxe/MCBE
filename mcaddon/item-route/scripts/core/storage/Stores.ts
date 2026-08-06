// ─── 仓库/索引/统计仓储接口（core 定义，mc 层实现 DP 分片） ──
// 这是持久化边界：core 只定义**可序列化快照结构 + 接口**（零 MC 依赖），
// mc 层（scripts/mc/storage/）用 DP 实现。
//   · WarehouseStore —— 仓库 meta 快照（单键 generation；容器注册表在 mc 层每容器一条键）
//   · IndexStore     —— 索引**每容器一条**条目（ir2:idx:{cid}，与注册表/统计同一风格）
//   · StatsStore     —— 统计**每容器一条**条目（ir2:cst:{cid}）
// 快照必须是纯 JSON（无函数/Map/Set），才能进出 DP（JSON.stringify/parse）。
// InMemory*Store 供 node 单测；真实 DP 版见 McWarehouseStore/McIndexStore/McStatsStore。
import { InMemoryKeyValueStore, type KeyValueStore } from "./KeyValueStore";
import type { ContainerId, PlayerId, WarehouseId } from "../model/types";
import type { Member, WarehouseArea, WarehouseSettings } from "../model/Warehouse";

// ── 快照结构（可序列化） ─────────────────────────────────
/** 仓库 meta 快照：不含容器（容器注册表是每容器一条键 + 每仓 cids 索引，mc 层维护） */
export interface WarehouseSnapshot {
  /** 仓库 ID（`w@(min)-(max)@维度`；resize 时迁移） */
  id: WarehouseId;
  /** 显示名（唯一） */
  displayName: string;
  /** 所有者玩家 ID */
  ownerId: PlayerId;
  /** 成员列表（owner 固定首项） */
  members: Member[];
  /** 区域（两对角点） */
  area: WarehouseArea;
  /** 仓库设置（默认容器角色/启用、运转/整理开关、速度、阈值） */
  settings: WarehouseSettings;
}

/** 索引单容器条目（持久化最小单位，与 ItemIndex.serializeContainer 对齐） */
export interface ContainerIndexEntry {
  /** 该容器含有的物品种类 ID 集合 */
  items: string[];
  /** 单物容器绑定类型（single 角色；无绑定省略） */
  singleBinding?: string;
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

/** 索引仓储：**每容器一条**条目（路由加速缓存，事件驱动最小单位） */
export interface IndexStore {
  /** 单容器索引条目（最小单位：该容器的物品集 + 单物绑定），键 ir2:idx:{cid} */
  saveContainer(cid: ContainerId, entry: ContainerIndexEntry): void;
  loadContainer(cid: ContainerId): ContainerIndexEntry | undefined;
  removeContainer(cid: ContainerId): void;
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

  saveContainer(cid: ContainerId, entry: ContainerIndexEntry): void {
    this.kv.write(key("idx", cid), entry);
  }

  loadContainer(cid: ContainerId): ContainerIndexEntry | undefined {
    return this.kv.read<ContainerIndexEntry>(key("idx", cid));
  }

  removeContainer(cid: ContainerId): void {
    this.kv.remove(key("idx", cid));
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
