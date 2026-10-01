import { world, system, Dimension } from "@minecraft/server";
import type { WarehouseData, WarehouseRuntimeModel } from "../types";

/**
 * 安全获取维度对象，避免因维度 ID 无效而抛出异常。
 *
 * @param dimensionId - 维度 ID（如 "overworld"、"nether"、"the_end"）
 * @returns 维度对象，获取失败时返回 undefined
 */
export function getDimensionSafe(dimensionId: string): Dimension | undefined {
  try {
    return world.getDimension(dimensionId);
  } catch {
    return undefined;
  }
}

/**
 * 采样仓库区域的 8 个角落检测区块是否已加载。
 *
 * **为何需要**：如果仓库所在区块全部或部分未加载，`getContainerFromStored`
 * 会逐个返回 undefined 并跳过，但逐个尝试效率低下。直接预检整个区域，如果
 * 有任何角落不可达，本次分拣直接跳过。
 *
 * **缓存策略**：每 40 tick（约 2 秒）才重新检查一次，避免每 tick 都采样。
 * 检查结果缓存在 `model.areaLoaded` 中。
 *
 * 从 SorterEngine.checkAreaLoaded 提取为独立函数，降低 SorterEngine 复杂度。
 *
 * @param warehouse - 仓库数据（含区域信息）
 * @param model - 运行时模型（含缓存字段）
 */
export function checkWarehouseAreaLoaded(warehouse: WarehouseData, model: WarehouseRuntimeModel): void {
  // 缓存有效期 40 tick ≈ 2 秒，避免每 tick 重复采样
  const RECHECK_INTERVAL = 40;
  if (model.areaLoaded !== undefined && system.currentTick - model.areaLoadedCheckedTick < RECHECK_INTERVAL) {
    return; // 缓存仍有效
  }

  const dimension = getDimensionSafe(warehouse.dimensionId);
  if (!dimension) {
    model.areaLoaded = false;
    model.areaLoadedCheckedTick = system.currentTick;
    return;
  }

  // 采样区域 8 个角落
  const { min, max } = warehouse.area;
  const corners: { x: number; y: number; z: number }[] = [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
  ];

  for (const corner of corners) {
    try {
      const block = dimension.getBlock(corner);
      if (!block) {
        model.areaLoaded = false;
        model.areaLoadedCheckedTick = system.currentTick;
        return;
      }
      // 访问 permutation 确认区块真正加载（getBlock 在部分版本可能返回占位对象）
      const _ = block.permutation;
    } catch {
      model.areaLoaded = false;
      model.areaLoadedCheckedTick = system.currentTick;
      return;
    }
  }

  model.areaLoaded = true;
  model.areaLoadedCheckedTick = system.currentTick;
}
