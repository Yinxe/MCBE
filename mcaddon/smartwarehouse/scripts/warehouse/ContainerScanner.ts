import type { Block, Dimension } from "@minecraft/server";
import type { BlockLocation, ContainerId, ContainerRole, StoredContainer, WarehouseArea } from "../types";
import { compareLocationForPrimary } from "../util/Vector";
import { makeContainerId } from "./ContainerId";
import { hasInventory, isChestType, isHopperType, isSupportedContainerType } from "./ContainerTypes";
import { probeDoubleChestSafely } from "./SafeProbe";

/** 单个箱子的最大槽位数（非双箱）。双箱的槽位数为 54，超过此值即为双箱。 */
const SINGLE_CHEST_SIZE = 27;

/**
 * 如果该位置所在的区块未加载、超出世界边界或发生其他错误，
 * 函数会捕获异常并返回 `undefined`，而不会中断扫描流程。
 *
 * 这是扫描容器的核心辅助函数，确保扫描在大范围区域中
 * 即使遇到未加载区块也能平稳跳过。
 *
 * @param dimension 目标维度
 * @param location 要获取方块的世界坐标
 * @returns 方块对象，如果获取失败则返回 undefined
 */
function tryGetBlock(dimension: Dimension, location: BlockLocation): Block | undefined {
  try {
    return dimension.getBlock(location);
  } catch {
    return undefined;
  }
}

/**
 * 容器扫描器。
 *
 * 负责在指定的矩形区域内扫描所有受支持的容器方块，
 * 识别并合并双箱（大箱子），然后返回以容器 ID 为键的记录。
 *
 * 扫描是同步的、全区域遍历的。调用方（参见 `WarehouseService`）
 * 必须在调用 `scan()` **之前** 强制执行扫描体积和容器数量上限，
 * 扫描器自身不做这些限制。
 */
export class ContainerScanner {
  /**
   * 在指定维度的矩形区域内扫描所有受支持的容器，并返回
   * 以容器唯一 ID 为键的容器记录。
   *
   * **注意：这是同步的全区域扫描。** 调用方（参见 `WarehouseService`）
   * 必须确保在调用 `scan()` **之前** 已强制执行扫描体积和容器数量上限
   * ——扫描器本身不防护大面积区域。
   *
   * 大箱子（双箱）检测逻辑：当发现两个相邻的同类型箱子方块时，
   * 将它们合并为一个容器记录，其中 `occupiedLocations` 包含两个坐标。
   *
   * @param dimension  目标维度
   * @param area       要扫描的矩形边界框（含边界）
   * @param defaultRole  新发现容器的默认角色
   * @param defaultEnabled  新发现的容器默认是否启用
   * @param existing   之前已知的容器记录，用于保留角色（role）和发现时间（discoveredAt）
   * @returns 容器 ID → StoredContainer 的记录
   */
  scan(
    dimension: Dimension,
    area: WarehouseArea,
    defaultRole: ContainerRole,
    defaultEnabled: boolean = true,
    existing: Record<ContainerId, StoredContainer> = {}
  ): Record<ContainerId, StoredContainer> {
    const dimensionId = dimension.id;
    const found: Record<ContainerId, StoredContainer> = {};
    const now = Date.now();

    // 遍历区域内的每一个方块位置
    for (let x = area.min.x; x <= area.max.x; x++) {
      for (let y = area.min.y; y <= area.max.y; y++) {
        for (let z = area.min.z; z <= area.max.z; z++) {
          const block = tryGetBlock(dimension, { x, y, z });
          // 跳过：方块不存在、不是支持的容器类型、或没有物品栏组件
          if (!block || !isSupportedContainerType(block.typeId) || !hasInventory(block)) {
            continue;
          }

          // 获取该容器实际占用的所有方块位置（双箱会返回两个位置）
          const occupied = this.getOccupiedLocations(dimension, { x, y, z }, block);
          // 排序后取第一个坐标作为「主位置」，用于生成容器 ID
          const primary = [...occupied].sort(compareLocationForPrimary)[0];
          const id = makeContainerId(dimensionId, primary);
          // 去重：如果该容器 ID 已经注册过，跳过（例如双箱的第二半）
          if (found[id]) continue;

          // 优先保留已有记录的角色和发现时间，否则使用默认值
          // 漏斗自动强制为 input 角色，不可作为存储容器
          const previous = existing[id];
          const forcedRole: ContainerRole = isHopperType(block.typeId) ? "input" : (previous?.role ?? defaultRole);
          found[id] = {
            id,
            dimensionId,
            primaryLocation: primary,
            occupiedLocations: occupied.sort(compareLocationForPrimary),
            role: forcedRole,
            enabled: previous?.enabled ?? defaultEnabled,
            discoveredAt: previous?.discoveredAt ?? now,
            updatedAt: now,
          };
        }
      }
    }

    return found;
  }

  /**
   * 解析一个容器实际占用的所有方块位置集合。
   *
   * - 非箱子类型：返回当前位置。
   * - 单箱（size ≤ 27）：不触发 setItem，直接返回当前位置。
   * - 大箱子（size > 27）：用探针法找另一半，setItem 受限时安全降级为单箱。
   *
   * @param dimension 目标维度
   * @param location 当前方块坐标
   * @param block 当前方块对象
   * @returns 该容器占用的方块位置数组
   */
  getOccupiedLocations(dimension: Dimension, location: BlockLocation, block: Block): BlockLocation[] {
    if (!isChestType(block.typeId)) return [location];

    // 读取 Container（不触 setItem）
    let container: import("@minecraft/server").Container | undefined;
    try {
      container = block.getComponent("inventory")?.container;
    } catch {
      return [location];
    }
    if (!container) return [location];

    // 单箱（≤ SINGLE_CHEST_SIZE 格）→ 直接返回
    if (container.size <= SINGLE_CHEST_SIZE) return [location];

    // 大箱子 → 安全探针法
    const neighbor = probeDoubleChestSafely(dimension, location, block);
    if (neighbor) return [location, neighbor];
    return [location];
  }
}
