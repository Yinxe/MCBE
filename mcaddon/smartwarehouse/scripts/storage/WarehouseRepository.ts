import type {
  ContainerId,
  StoredContainer,
  WarehouseContainerShard,
  WarehouseData,
  WarehouseId,
  WarehouseIndex,
  WarehouseMeta,
  WarehouseSettings,
} from "../types";
import { DynamicPropertyStore } from "./DynamicPropertyStore";

/** 仓库索引在动态属性中存储的键名 */
const INDEX_KEY = "sw:index";
/** 每个分片最多容纳的容器数量 —— 用于将容器数据分片存储，避免单条动态属性超限 */
const CONTAINERS_PER_SHARD = 128;

export const DEFAULT_WAREHOUSE_SETTINGS: WarehouseSettings = {
  defaultNewContainerRole: "disabled",
  autoCreateCategories: false,
  enabled: true,
  debug: false,
};

/**
 * 规范化仓库 ID：去除首尾空格、转为小写，并校验格式。
 * 只允许英文小写字母、数字、下划线和短横线，长度限制 1-32 个字符。
 * @param input 原始输入的仓库 ID
 * @returns 规范化后的合法仓库 ID
 * @throws 如果格式不合法则抛出错误
 */
export function normalizeWarehouseId(input: string): WarehouseId {
  const id = input.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(id)) {
    throw new Error("仓库 ID 只能包含英文小写、数字、下划线、短横线，长度 1-32");
  }
  return id;
}

/** 构造仓库元数据在动态属性中存储的键名 */
function metaKey(id: WarehouseId): string {
  return `sw:warehouse:${id}:meta`;
}

/** 构造指定仓库指定分片的容器数据在动态属性中存储的键名 */
function shardKey(id: WarehouseId, shardIndex: number): string {
  return `sw:warehouse:${id}:containers:${shardIndex}`;
}

/**
 * 仓库持久化仓储 —— 负责将仓库数据（元数据 + 容器分片 + 索引）读写到 Minecraft 世界动态属性中。
 *
 * 设计要点：
 * - 容器数据按 CONTAINERS_PER_SHARD（128）分片存储，避免单条动态属性超过大小限制。
 * - 写入时先写容器分片、最后写元数据；读取时先读元数据、再遍历分片 —— 保证崩溃时的一致性。
 * - 全局索引（INDEX_KEY）记录所有已注册的仓库 ID，用于快速列举。
 */
export class WarehouseRepository {
  /**
   * @param store 底层动态属性存储实例，默认使用新的 DynamicPropertyStore
   */
  constructor(private readonly store = new DynamicPropertyStore()) {}

  /** 读取全局仓库索引（如果不存在则返回默认空索引） */
  getIndex(): WarehouseIndex {
    return this.store.getJson<WarehouseIndex>(INDEX_KEY, { version: 1, warehouses: [] });
  }

  /** 持久化全局仓库索引 */
  saveIndex(index: WarehouseIndex): void {
    this.store.setJson(INDEX_KEY, index);
  }

  /** 检查指定 ID 的仓库是否已在索引中注册 */
  exists(id: WarehouseId): boolean {
    return this.getIndex().warehouses.includes(id);
  }

  /**
   * 从持久化存储中加载指定仓库的完整数据（元数据 + 所有容器）。
   * 先读取元数据获取分片数量，再遍历每个分片合并容器对象。
   * @param id 仓库 ID
   * @returns 仓库数据对象，如果仓库不存在则返回 undefined
   */
  load(id: WarehouseId): WarehouseData | undefined {
    const meta = this.store.getJson<WarehouseMeta | undefined>(metaKey(id), undefined);
    if (!meta) return undefined;

    const containers: Record<ContainerId, StoredContainer> = {};
    for (let shardIndex = 0; shardIndex < meta.containerShardCount; shardIndex++) {
      const shard = this.store.getJson<WarehouseContainerShard>(shardKey(id, shardIndex), {
        version: 1,
        warehouseId: id,
        shardIndex,
        containers: {},
      });
      Object.assign(containers, shard.containers);
    }

    return { ...meta, containers };
  }

  /**
   * 将仓库数据完整持久化（覆盖写入）。
   *
   * 写入顺序保证一致性：
   * 1. 先写所有新的容器分片
   * 2. 清理旧分片中多余的（分片数减少时）
   * 3. 最后写元数据 —— 若在步骤 3 之前崩溃，load() 仍读到旧元数据，状态一致
   *
   * @param data 要保存的仓库完整数据
   */
  save(data: WarehouseData): void {
    // 读取已有的元数据，获取旧的分片数量，用于后续清理多余分片
    const existingMeta = this.store.getJson<WarehouseMeta | undefined>(metaKey(data.id), undefined);
    const oldShardCount = existingMeta?.containerShardCount ?? 0;

    const entries = Object.entries(data.containers);
    // 根据容器数量计算所需分片数，最少为 1
    const shardCount = Math.max(1, Math.ceil(entries.length / CONTAINERS_PER_SHARD));
    const meta: WarehouseMeta = {
      version: 1,
      id: data.id,
      displayName: data.displayName,
      dimensionId: data.dimensionId,
      area: data.area,
      settings: data.settings,
      containerShardCount: shardCount,
    };

    // 步骤 1：写入所有新分片数据
    for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
      const slice = entries.slice(shardIndex * CONTAINERS_PER_SHARD, (shardIndex + 1) * CONTAINERS_PER_SHARD);
      const shard: WarehouseContainerShard = {
        version: 1,
        warehouseId: data.id,
        shardIndex,
        containers: Object.fromEntries(slice),
      };
      this.store.setJson(shardKey(data.id, shardIndex), shard);
    }

    // 步骤 2：清理分片数减少后遗留的旧分片
    for (let i = shardCount; i < oldShardCount; i++) {
      this.store.delete(shardKey(data.id, i));
    }

    // 步骤 3：最后写入元数据 —— 若在此步之前崩溃，load() 看到的是旧元数据（一致状态）
    this.store.setJson(metaKey(data.id), meta);
  }

  /**
   * 创建一个新仓库。
   * 包含两步操作：先持久化数据（save），再更新索引（saveIndex）。
   * 如果索引更新失败则回滚（删除已写入的仓库数据），防止出现有数据但无索引的孤儿仓库。
   * @param data 仓库完整数据
   * @throws 如果仓库 ID 已存在则抛出错误
   */
  create(data: WarehouseData): void {
    const index = this.getIndex();
    if (index.warehouses.includes(data.id)) throw new Error(`仓库 ${data.id} 已存在`);
    this.save(data);
    try {
      this.saveIndex({ version: 1, warehouses: [...index.warehouses, data.id] });
    } catch (error) {
      // 回滚：save() 已写入数据但索引更新失败 —— 删除孤儿数据保证一致性
      this.delete(data.id);
      throw error;
    }
  }

  /**
   * 删除指定仓库及其所有数据。
   * 先清理仓库元数据和所有分片，再更新全局索引移除该仓库 ID。
   * @param id 要删除的仓库 ID
   */
  delete(id: WarehouseId): void {
    const existing = this.load(id);
    if (existing) {
      this.store.delete(metaKey(id));
      for (let i = 0; i < existing.containerShardCount; i++) this.store.delete(shardKey(id, i));
    }
    const index = this.getIndex();
    this.saveIndex({ version: 1, warehouses: index.warehouses.filter((warehouseId) => warehouseId !== id) });
  }

  /** 加载索引中所有注册的仓库数据，自动过滤掉已损坏或不存在的仓库 */
  loadAll(): WarehouseData[] {
    return this.getIndex()
      .warehouses.map((id) => this.load(id))
      .filter((warehouse): warehouse is WarehouseData => Boolean(warehouse));
  }
}
