import type { BlockLocation, ContainerId, DimensionId } from "../types";
import { locationKey } from "../util/Vector";

/**
 * 根据维度 ID 和容器的主位置生成唯一的容器标识符（ContainerId）。
 * 容器 ID 在整个智能仓库系统中作为容器的唯一键使用，
 * 用于在仓库数据记录中索引和查找容器。
 *
 * 生成规则委托给 `locationKey` 工具函数，
 * 确保同一维度、同一位置始终映射到相同的字符串 ID。
 *
 * @param dimensionId 容器所在的维度 ID，例如 "minecraft:overworld"
 * @param primaryLocation 容器的主位置坐标（双箱取西北/西南角）
 * @returns 容器的唯一字符串标识符
 */
export function makeContainerId(dimensionId: DimensionId, primaryLocation: BlockLocation): ContainerId {
  return locationKey(dimensionId, primaryLocation);
}

/**
 * 生成运行时「占用位置索引」（occupiedLocationIndex）使用的定位键字符串。
 * 该索引用于快速查询某个世界坐标被哪个容器占用。
 *
 * 键的格式与 `makeContainerId` 保持一致，因此索引查找和容器 ID 比较
 * 使用相同的字符串表示。之所以将该功能拆分为独立的函数而非内联，
 * 是为了使其用途（运行时索引，而非容器标识）在代码中一目了然。
 *
 * @param dimensionId 维度 ID
 * @param location 要生成键的方块坐标
 * @returns 适用于占用位置索引的定位键字符串
 */
export function makeOccupiedLocationKey(dimensionId: DimensionId, location: BlockLocation): string {
  return locationKey(dimensionId, location);
}
