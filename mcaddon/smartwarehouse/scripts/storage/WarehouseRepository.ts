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
  defaultNewContainerRole: "misc",
  defaultNewContainerEnabled: true,
  autoCreateCategories: false,
  enabled: true,
  processingSpeed: 8,
  debug: false,
  showBoundary: false,
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

/**
 * 构造指定仓库指定世代指定分片的容器数据在动态属性中存储的键名。
 *
 * **世代号（generation）设计**：每次 `save()` 递增世代号，新数据写入新世代
 * 的键中，旧世代数据不受影响。写入完成后更新 meta 指向新世代，再清理旧
 * 世代数据。这样在任何时刻崩溃，都不会出现旧数据被部分覆盖的情况。
 */
function shardKey(id: WarehouseId, gen: number, shardIndex: number): string {
  return `sw:warehouse:${id}:${gen}:containers:${shardIndex}`;
}

/**
 * 仓库持久化仓储 —— 负责将仓库数据（元数据 + 容器分片 + 索引）读写到 Minecraft 世界动态属性中。
 *
 * 设计要点：
 * - 容器数据按 CONTAINERS_PER_SHARD（128）分片存储，避免单条动态属性超过大小限制。
 * - 分片键使用**世代号**（containerShardGeneration），每次写入递增，
 *   新数据写入新键，旧数据不被覆盖。崩溃恢复时数据一致。
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
   *
   * 读取流程：
   * 1. 读取 meta，获取世代号和各分片信息
   * 2. 遍历每个分片，按世代号构造键名读取容器数据
   * 3. **完整性校验**：比较实际容器数与 meta 记录的 containerCount，
   *    不一致则记录错误日志（管理员可发现数据损坏）
   *
   * @param id 仓库 ID
   * @returns 仓库数据对象，如果仓库不存在则返回 undefined
   */
  load(id: WarehouseId): WarehouseData | undefined {
    const meta = this.store.getJson<WarehouseMeta | undefined>(metaKey(id), undefined);
    if (!meta) return undefined;

    const containers: Record<ContainerId, StoredContainer> = {};
    for (let shardIndex = 0; shardIndex < meta.containerShardCount; shardIndex++) {
      const shard = this.store.getJson<WarehouseContainerShard>(
        shardKey(id, meta.containerShardGeneration, shardIndex),
        {
          version: 1,
          warehouseId: id,
          shardIndex,
          containers: {},
        }
      );
      Object.assign(containers, shard.containers);
    }

    // 完整性校验：实际容器数量应与 meta 记录一致
    const actualCount = Object.keys(containers).length;
    if (actualCount !== meta.containerCount) {
      console.error(
        `[SmartWarehouse] 仓库 ${id} 数据完整性校验失败：` +
          `meta 记录 ${meta.containerCount} 个容器，实际读到 ${actualCount} 个。` +
          `数据可能已损坏。`
      );
    }

    return { ...meta, containers };
  }

  /**
   * 将仓库数据完整持久化（覆盖写入）。
   *
   * **崩溃安全设计：**
   * 1. 递增世代号，新数据写入新世代的分片键
   * 2. 写 meta（指向新世代 + 实际容器计数）
   * 3. 清理旧世代的分片键
   *
   * 在任何步骤崩溃：
   * - 步骤 1 后崩溃 → meta 仍指向旧世代，load 读到旧数据（一致）
   * - 步骤 2 后崩溃 → meta 指向新世代，load 读到新数据（一致）
   * - 步骤 3 未完成 → 遗留旧键但不影响正确性（不会被读取）
   *
   * @param data 要保存的仓库完整数据
   */
  save(data: WarehouseData): void {
    const existingMeta = this.store.getJson<WarehouseMeta | undefined>(metaKey(data.id), undefined);
    const oldGen = existingMeta?.containerShardGeneration ?? 0;
    const newGen = oldGen + 1;
    const oldShardCount = existingMeta?.containerShardCount ?? 0;

    const entries = Object.entries(data.containers);
    const shardCount = Math.max(1, Math.ceil(entries.length / CONTAINERS_PER_SHARD));

    // 步骤 1：写入新世代的所有分片
    for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
      const slice = entries.slice(shardIndex * CONTAINERS_PER_SHARD, (shardIndex + 1) * CONTAINERS_PER_SHARD);
      const shard: WarehouseContainerShard = {
        version: 1,
        warehouseId: data.id,
        shardIndex,
        containers: Object.fromEntries(slice),
      };
      this.store.setJson(shardKey(data.id, newGen, shardIndex), shard);
    }

    // 步骤 2：写入 meta（指向新世代，并记录容器总数用于完整性校验）
    const meta: WarehouseMeta = {
      version: 1,
      id: data.id,
      displayName: data.displayName,
      dimensionId: data.dimensionId,
      area: data.area,
      ownerId: data.ownerId,
      settings: data.settings,
      containerShardCount: shardCount,
      containerCount: entries.length,
      containerShardGeneration: newGen,
    };
    this.store.setJson(metaKey(data.id), meta);

    // 步骤 3：清理旧世代的分片键
    for (let i = 0; i < oldShardCount; i++) {
      this.store.delete(shardKey(data.id, oldGen, i));
    }
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
      try {
        this.delete(data.id);
      } catch (deleteError) {
        // 回滚本身也可能失败，此时记录错误但继续抛出原始异常
        console.error(
          `[SmartWarehouse] 创建仓库 ${data.id} 失败后回滚也失败: ${deleteError}`
        );
      }
      throw error; // 始终抛出原始异常
    }
  }

  /**
   * 删除指定仓库及其所有数据。
   * 先清理仓库元数据和所有分片，再更新全局索引移除该仓库 ID。
   * @param id 要删除的仓库 ID
   */
  delete(id: WarehouseId): void {
    // 只读 meta（轻量操作）获取世代号和分片数，避免加载全量容器数据
    const meta = this.store.getJson<WarehouseMeta | undefined>(metaKey(id), undefined);
    if (meta) {
      const gen = meta.containerShardGeneration;
      this.store.delete(metaKey(id));
      for (let i = 0; i < meta.containerShardCount; i++) {
        this.store.delete(shardKey(id, gen, i));
      }
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
