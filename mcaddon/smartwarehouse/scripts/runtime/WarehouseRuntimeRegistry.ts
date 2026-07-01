import type { WarehouseId, WarehouseRuntimeModel } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { buildWarehouseRuntimeModel } from "./WarehouseRuntimeModel";

/**
 * 运行时仓库模型的内存缓存。
 *
 * **MVP 缓存策略：** 不自动淘汰。模型会一直保留，直到通过 `delete()` 显式删除
 * 或通过 `markDirty()` 标记为脏（下次调用 `getOrBuild()` 时会触发重载）。
 *
 * 此策略在 MVP 阶段是可接受的，因为：
 * - 仓库总数受 `WarehouseService` 中 `MAX_SCAN_VOLUME` / `MAX_CONTAINERS` 的限制；
 * - 每个模型是小型内存结构（约数百个容器条目）。
 *
 * 如果系统未来扩展到支持数百个活跃仓库（跨越未加载区块），可能需要引入 LRU
 * 或基于区块的淘汰策略。
 */
export class WarehouseRuntimeRegistry {
  /** 仓库 ID → 运行时模型的映射，作为内存缓存 */
  private readonly models = new Map<WarehouseId, WarehouseRuntimeModel>();

  /**
   * @param repository 底层仓库持久化仓储，用于在缓存未命中时从动态属性加载数据
   */
  constructor(private readonly repository: WarehouseRepository) {}

  /**
   * 获取或构建指定仓库的运行时模型。
   *
   * 如果缓存中存在且未标记为脏（dirty），直接返回缓存。
   * 否则从持久化存储加载仓库数据并构建新的运行时模型。
   * 构建时会保留旧的 inputCursor，并在新模型的输入容器列表上取模以保证游标不越界。
   *
   * @param id 仓库 ID
   * @returns 运行时模型，如果仓库不存在则返回 undefined
   */
  getOrBuild(id: WarehouseId): WarehouseRuntimeModel | undefined {
    const existing = this.models.get(id);
    if (existing && !existing.dirty) return existing;

    const warehouse = this.repository.load(id);
    if (!warehouse) return undefined;

    const model = buildWarehouseRuntimeModel(warehouse);
    // 保留旧的 inputCursor，并在新模型的输入容器数量上取模，防止数组越界
    const oldCursor = existing?.inputCursor ?? 0;
    model.inputCursor = model.inputContainerIds.length > 0 ? oldCursor % model.inputContainerIds.length : 0;
    this.models.set(id, model);
    return model;
  }

  /**
   * 将指定仓库的运行时模型标记为脏（dirty）。
   * 标记后，下次调用 `getOrBuild()` 时会从持久化存储重新加载。
   * 适用于仓库数据（如容器列表、配置）发生变更后的缓存失效通知。
   * @param id 仓库 ID
   */
  markDirty(id: WarehouseId): void {
    const model = this.models.get(id);
    if (model) model.dirty = true;
  }

  /**
   * 从内存缓存中移除指定仓库的运行时模型。
   * 注意：此操作不影响持久化存储中的数据，仅清除内存缓存。
   * @param id 仓库 ID
   */
  delete(id: WarehouseId): void {
    this.models.delete(id);
  }
}
