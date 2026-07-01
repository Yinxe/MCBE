import type { ContainerId, WarehouseData, WarehouseRuntimeModel } from "../types";
import { makeOccupiedLocationKey } from "../warehouse/ContainerId";

/**
 * 根据仓库持久化数据构建运行时模型。
 *
 * 运行时模型（WarehouseRuntimeModel）在持久化数据（WarehouseData）之上添加了
 * 便于高效查询的索引结构（Map、按角色分类的 ID 列表等），仅存在于内存中，不会被持久化。
 *
 * @param warehouse 从仓库仓储层加载的持久化数据
 * @returns 构建好的运行时模型，包含各种优化索引
 */
export function buildWarehouseRuntimeModel(warehouse: WarehouseData): WarehouseRuntimeModel {
  const model: WarehouseRuntimeModel = {
    warehouseId: warehouse.id,
    /** 容器 ID → 容器对象的映射，用于快速查找 */
    containersById: new Map(),
    /**
     * 世界坐标 → 容器 ID 的映射（1:1）。
     * 用于快速判断某个世界坐标是否被容器占用。
     */
    occupiedLocationIndex: new Map(),
    /** 角色为 "input"（输入）的容器 ID 列表 */
    inputContainerIds: [],
    /** 角色为 "normal"（普通）的容器 ID 列表 */
    normalContainerIds: [],
    /** 角色为 "misc"（杂项）的容器 ID 列表 */
    miscContainerIds: [],
    /** 角色为 "bulk"（批量）的容器 ID 列表 */
    bulkContainerIds: [],
    /** 角色为 "disabled"（禁用）或其他未知角色的容器 ID 列表 */
    disabledContainerIds: [],
    /**
     * 运行时优化索引：物品类型 ID → 包含该物品的容器 ID 列表。
     * 由分拣引擎（sorter）在访问容器时惰性构建，**不会被持久化**。
     * 过期条目不会导致数据丢失，仅会产生一次重新发现的性能开销。
     */
    itemTypeIndex: new Map<string, ContainerId[]>(),
    /** 轮询调度输入容器时的游标位置 */
    inputCursor: 0,
    /** 模型构建时间戳，用于缓存过期判断 */
    lastBuiltAt: Date.now(),
    /** 标记模型是否已被标记为脏（需要重新加载） */
    dirty: false,
  };

  for (const container of Object.values(warehouse.containers)) {
    // 深拷贝容器对象中的 occupiedLocations 数组，防止对持久化数据的无意识修改
    model.containersById.set(container.id, { ...container, occupiedLocations: [...container.occupiedLocations] });
    for (const location of container.occupiedLocations) {
      const locationKey = makeOccupiedLocationKey(container.dimensionId, location);
      // occupiedLocationIndex 是世界坐标到容器的 1:1 映射，重复键意味着容器定义重叠。
      // 在正确的扫描器下不应发生 —— 此处打印警告并跳过，保留先注册的容器。
      if (model.occupiedLocationIndex.has(locationKey)) {
        console.warn(
          `[SmartWarehouse] 发现重复的已占用位置 ${locationKey}：容器 ${model.occupiedLocationIndex.get(locationKey)} 已注册，跳过 ${container.id}`
        );
        continue;
      }
      model.occupiedLocationIndex.set(locationKey, container.id);
    }
    // 按角色分类归入不同列表，便于分拣引擎按策略选择容器
    if (container.role === "input") model.inputContainerIds.push(container.id);
    else if (container.role === "normal") model.normalContainerIds.push(container.id);
    else if (container.role === "misc") model.miscContainerIds.push(container.id);
    else if (container.role === "bulk") model.bulkContainerIds.push(container.id);
    else model.disabledContainerIds.push(container.id);
  }

  return model;
}
