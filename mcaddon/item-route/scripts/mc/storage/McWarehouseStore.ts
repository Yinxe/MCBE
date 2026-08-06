// ─── 仓库仓储：注册表 + 世代元数据 + 容器注册表（每容器一条键） ──
// 三个数据面，全部经 ShardStore：
//   · `ir2:registry`（overwrite）—— 仓库 ID 列表，快照清单枚举用
//   · `ir2:wh:{id}:meta`（generation）—— WarehouseSnapshot（含 containerIds，不含容器几何）
//   · 容器注册表 —— **每容器一条键** `ir2:c:{containerId}`（全局容器 ID，对齐统计
//     `ir2:cst:{containerId}` 约定）+ 每仓索引 `ir2:wh:{id}:cids`（ContainerId[]）。
//     好处：单容器属性变更只重写该容器自己的键（最小单位），整仓容器再多也不撑爆单键；
//     旧版整仓键 `ir2:wh:{id}:containers` 仅用于读侧**一次性迁移**。
// 用 overwrite 模式（单容器条目/索引都小）；generation 留给 meta/大快照防崩溃半截。
import type { ShardStore } from "./ShardStore";
import type { ContainerId, Location, WarehouseId } from "../../core/model/types";
import type { ContainerRole } from "../../core/model/Container";
import type { WarehouseSnapshot } from "../../core/storage/Stores";

// ── 键规划 ─────────────────────────────────────────────
const REGISTRY_KEY = "ir2:registry";
const metaKey = (id: WarehouseId): string => `ir2:wh:${id}:meta`;
/** 每容器注册表条目（全局容器 ID 唯一，无需仓库前缀） */
const containerKey = (cid: ContainerId): string => `ir2:c:${cid}`;
/** 该仓容器 ID 索引（枚举/清理/迁移用） */
const containerIdsKey = (wid: WarehouseId): string => `ir2:wh:${wid}:cids`;
/** 旧版整仓容器注册表键（v2 前一版）：仅迁移读取用 */
const legacyContainersKey = (wid: WarehouseId): string => `ir2:wh:${wid}:containers`;

interface Registry { warehouses: WarehouseId[]; }

/** 持久化容器条目：重启重建适配器的几何/属性信息 */
export interface ContainerEntry {
  id: ContainerId;
  role: ContainerRole;
  locations: Location[];
  enabled: boolean;
  priority: number;
}

export class McWarehouseStore {
  constructor(private readonly shards: ShardStore) {}

  list(): WarehouseSnapshot[] {
    const reg = this.shards.read<Registry>(REGISTRY_KEY);
    const out: WarehouseSnapshot[] = [];
    for (const id of reg?.warehouses ?? []) {
      const w = this.load(id);
      if (w) out.push(w);
    }
    return out;
  }

  load(id: WarehouseId): WarehouseSnapshot | undefined {
    return this.shards.read<WarehouseSnapshot>(metaKey(id));
  }

  save(snapshot: WarehouseSnapshot): void {
    this.shards.write(metaKey(snapshot.id), snapshot, "generation");
    const reg = this.shards.read<Registry>(REGISTRY_KEY) ?? { warehouses: [] };
    if (!reg.warehouses.includes(snapshot.id)) {
      reg.warehouses.push(snapshot.id);
      this.shards.write(REGISTRY_KEY, reg, "overwrite");
    }
  }

  remove(id: WarehouseId): void {
    this.shards.remove(metaKey(id));
    // 清容器注册表：索引 → 每个容器键 → 旧整仓键（全局容器键不随仓库删而残留）
    const cids = this.shards.read<ContainerId[]>(containerIdsKey(id)) ?? [];
    for (const cid of cids) this.shards.remove(containerKey(cid));
    this.shards.remove(containerIdsKey(id));
    this.shards.remove(legacyContainersKey(id));
    const reg = this.shards.read<Registry>(REGISTRY_KEY);
    if (reg) {
      reg.warehouses = reg.warehouses.filter((w) => w !== id);
      this.shards.write(REGISTRY_KEY, reg, "overwrite");
    }
  }

  // ── 容器注册表：每容器一条键（最小单位写入） ─────────────
  /** 写单个容器的注册表条目（overwrite，条目小无需 generation） */
  saveContainer(cid: ContainerId, entry: ContainerEntry): void {
    this.shards.write(containerKey(cid), entry, "overwrite");
  }

  loadContainer(cid: ContainerId): ContainerEntry | undefined {
    return this.shards.read<ContainerEntry>(containerKey(cid));
  }

  /** 移除单个容器的注册表键 */
  removeContainer(cid: ContainerId): void {
    this.shards.remove(containerKey(cid));
  }

  /** 写该仓容器 ID 索引（枚举/清理用） */
  saveContainerIds(wid: WarehouseId, cids: ContainerId[]): void {
    this.shards.write(containerIdsKey(wid), cids, "overwrite");
  }

  loadContainerIds(wid: WarehouseId): ContainerId[] | undefined {
    return this.shards.read<ContainerId[]>(containerIdsKey(wid));
  }

  removeContainerIds(wid: WarehouseId): void {
    this.shards.remove(containerIdsKey(wid));
  }

  /**
   * 枚举某仓全部容器条目（Phase 4 重建用）。
   * 若命中旧整仓键则**就地迁移**：逐容器写单键 + 写索引 + 删旧键（一次性，幂等）。
   */
  loadAllContainers(wid: WarehouseId): ContainerEntry[] {
    const legacy = this.shards.read<ContainerEntry[]>(legacyContainersKey(wid));
    if (legacy !== undefined) {
      const cids: ContainerId[] = [];
      for (const e of legacy) {
        this.shards.write(containerKey(e.id), e, "overwrite");
        cids.push(e.id);
      }
      this.shards.write(containerIdsKey(wid), cids, "overwrite");
      this.shards.remove(legacyContainersKey(wid));
      return legacy;
    }
    const cids = this.shards.read<ContainerId[]>(containerIdsKey(wid)) ?? [];
    const out: ContainerEntry[] = [];
    for (const cid of cids) {
      const e = this.shards.read<ContainerEntry>(containerKey(cid));
      if (e !== undefined) out.push(e);
    }
    return out;
  }
}
