// ─── 仓库仓储：meta + 容器注册表（每容器一条键，普通 DP 直存） ──
// 数据面（容器级小值，全部 **DirectStore** 普通 DP 单键，无分片/hash 开销）：
//   · `ir2:registry` —— 仓库 ID 列表，快照清单枚举用
//   · `ir2:wh:{id}:meta` —— WarehouseSnapshot（不含容器；容器列表由 cids 索引权威）
//   · 容器注册表 —— **每容器一条键** `ir2:c:{containerId}`（全局容器 ID，对齐统计
//     `ir2:cst:{containerId}` 约定）+ 每仓索引 `ir2:wh:{id}:cids`（ContainerId[]）。
//     单容器属性变更只重写该容器自己的键（最小单位），整仓容器再多也不撑爆单键。
//   · 旧版整仓键 `ir2:wh:{id}:containers`（v2 前一版，ShardStore 分包格式）仅在读侧
//     **一次性迁移**时经 legacyShards 读取，迁移后删除。
import type { DirectStore } from "./DirectStore";
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
/** 旧版整仓容器注册表键（v2 前一版，ShardStore 分包格式）：仅迁移读取用 */
const legacyContainersKey = (wid: WarehouseId): string => `ir2:wh:${wid}:containers`;

interface Registry {
  warehouses: WarehouseId[];
}

/** 持久化容器条目：重启重建适配器的几何/属性信息 */
export interface ContainerEntry {
  id: ContainerId;
  role: ContainerRole;
  locations: Location[];
  enabled: boolean;
  priority: number;
}

/**
 * 仓库仓储：meta 单键 + 容器注册表**每容器一条键**（ir2:c:{cid}）+ 每仓 cids 索引，全部普通 DP 直存。
 *  - meta：`ir2:wh:{id}:meta`（WarehouseSnapshot，不含容器——容器列表由 cids 索引权威）
 *  - 注册表：`ir2:c:{cid}`（ContainerEntry）+ `ir2:wh:{id}:cids`
 *  - loadAllContainers 若命中旧整仓键（ir2:wh:{id}:containers，旧 ShardStore 格式）则经 legacyShards
 *    就地迁移拆为每容器单键（幂等）；新格式直接读 cids 索引 + 每容器键。
 * 删除仓库（remove）清理 meta + cids + 每个容器键，防残留。
 */
export class McWarehouseStore {
  constructor(
    private readonly store: DirectStore,
    /** 旧版整仓键（ShardStore 分包格式）迁移用；新世界可不传 */
    private readonly legacyShards?: ShardStore
  ) {}

  list(): WarehouseSnapshot[] {
    const reg = this.store.read<Registry>(REGISTRY_KEY);
    const out: WarehouseSnapshot[] = [];
    for (const id of reg?.warehouses ?? []) {
      const w = this.load(id);
      if (w) out.push(w);
    }
    return out;
  }

  load(id: WarehouseId): WarehouseSnapshot | undefined {
    return this.store.read<WarehouseSnapshot>(metaKey(id));
  }

  save(snapshot: WarehouseSnapshot): void {
    this.store.write(metaKey(snapshot.id), snapshot);
    const reg = this.store.read<Registry>(REGISTRY_KEY) ?? { warehouses: [] };
    if (!reg.warehouses.includes(snapshot.id)) {
      reg.warehouses.push(snapshot.id);
      this.store.write(REGISTRY_KEY, reg);
    }
  }

  remove(id: WarehouseId): void {
    this.store.remove(metaKey(id));
    // 清容器注册表：索引 → 每个容器键 → 旧整仓键（全局容器键不随仓库删而残留）
    const cids = this.store.read<ContainerId[]>(containerIdsKey(id)) ?? [];
    for (const cid of cids) this.store.remove(containerKey(cid));
    this.store.remove(containerIdsKey(id));
    this.legacyShards?.remove(legacyContainersKey(id));
    const reg = this.store.read<Registry>(REGISTRY_KEY);
    if (reg) {
      reg.warehouses = reg.warehouses.filter((w) => w !== id);
      this.store.write(REGISTRY_KEY, reg);
    }
  }

  // ── 容器注册表：每容器一条键（最小单位写入） ─────────────
  /** 写单个容器的注册表条目（单容器小值，普通 DP 直存） */
  saveContainer(cid: ContainerId, entry: ContainerEntry): void {
    this.store.write(containerKey(cid), entry);
  }

  loadContainer(cid: ContainerId): ContainerEntry | undefined {
    return this.store.read<ContainerEntry>(containerKey(cid));
  }

  /** 移除单个容器的注册表键 */
  removeContainer(cid: ContainerId): void {
    this.store.remove(containerKey(cid));
  }

  /** 写该仓容器 ID 索引（枚举/清理用） */
  saveContainerIds(wid: WarehouseId, cids: ContainerId[]): void {
    this.store.write(containerIdsKey(wid), cids);
  }

  loadContainerIds(wid: WarehouseId): ContainerId[] | undefined {
    return this.store.read<ContainerId[]>(containerIdsKey(wid));
  }

  removeContainerIds(wid: WarehouseId): void {
    this.store.remove(containerIdsKey(wid));
  }

  /**
   * 枚举某仓全部容器条目（Phase 4 重建用）。
   * 若命中旧整仓键（legacyShards，旧 ShardStore 格式）则**就地迁移**：逐容器写单键 + 写索引 + 删旧键
   * （一次性，幂等）；否则读 cids 索引 + 每容器键。
   */
  loadAllContainers(wid: WarehouseId): ContainerEntry[] {
    const legacy = this.legacyShards?.read<ContainerEntry[]>(legacyContainersKey(wid));
    if (legacy !== undefined) {
      const cids: ContainerId[] = [];
      for (const e of legacy) {
        this.store.write(containerKey(e.id), e);
        cids.push(e.id);
      }
      this.store.write(containerIdsKey(wid), cids);
      this.legacyShards?.remove(legacyContainersKey(wid));
      return legacy;
    }
    const cids = this.store.read<ContainerId[]>(containerIdsKey(wid)) ?? [];
    const out: ContainerEntry[] = [];
    for (const cid of cids) {
      const e = this.store.read<ContainerEntry>(containerKey(cid));
      if (e !== undefined) out.push(e);
    }
    return out;
  }
}