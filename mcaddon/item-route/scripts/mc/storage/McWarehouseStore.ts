// ─── 仓库仓储：注册表 + 世代分片元数据 + 容器注册表（全量重写） ──
import type { ShardStore } from "./ShardStore";
import type { ContainerId, Location, WarehouseId } from "../../core/model/types";
import type { ContainerRole } from "../../core/model/Container";
import type { WarehouseSnapshot } from "../../core/storage/Stores";

// ── 键规划 ─────────────────────────────────────────────
const REGISTRY_KEY = "ir2:registry";
const metaKey = (id: WarehouseId): string => `ir2:wh:${id}:meta`;
const containersKey = (id: WarehouseId): string => `ir2:wh:${id}:containers`;

interface Registry { warehouses: WarehouseId[]; }

/** 持久化容器条目：重启重建适配器的几何信息 */
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
    this.shards.remove(containersKey(id));
    const reg = this.shards.read<Registry>(REGISTRY_KEY);
    if (reg) {
      reg.warehouses = reg.warehouses.filter((w) => w !== id);
      this.shards.write(REGISTRY_KEY, reg, "overwrite");
    }
  }

  /** 容器注册表：全量重写（generation，孤儿清理由 ShardStore 完成） */
  saveContainers(id: WarehouseId, entries: ContainerEntry[]): void {
    this.shards.write(containersKey(id), entries, "generation");
  }

  loadContainers(id: WarehouseId): ContainerEntry[] | undefined {
    return this.shards.read<ContainerEntry[]>(containersKey(id));
  }
}