import { world, Dimension, ItemStack } from "@minecraft/server";
import type { WarehouseData, WarehouseId, WarehouseRuntimeModel, ContainerId } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { WarehouseRuntimeRegistry } from "../runtime/WarehouseRuntimeRegistry";
import { Logger } from "../util/Logger";
import {
  getContainerFromStored,
  containerHasType,
  isContainerEmpty,
  tryMoveStackIntoContainer,
} from "./ContainerInventory";

const log = new Logger("SorterEngine");

/**
 * 分拣引擎 —— 将物品从输入容器分拣到对应的存储容器（普通 / 杂项）中。
 *
 * ### 分拣优先级（每个物品堆）
 *
 * 按照以下优先级依次尝试放置物品：
 *
 * 1. **已有同类物品的普通容器**（优先利用运行时 `itemTypeIndex` 索引实现快速查找，
 *    索引会在发现脏数据时惰性修正）。
 * 2. **空的普通容器**（仅在 `autoCreateCategories` 开启时启用，用于自动创建新分类）。
 * 3. **杂项容器**（兜底，任何物品最终都能放入杂项容器）。
 *
 * ### 设计要点
 *
 * - **索引自愈机制**：`itemTypeIndex` 是一个运行时缓存，记录每个物品种类对应的容器列表。
 *   当容器被搬空或更换后索引可能过时，`findExistingTypeContainers` 会在每次查询时
 *   校验索引项的有效性并惰性清除脏数据，同时将新发现的容器写回索引。
 * - **双遍扫描**：对于没有索引记录的物品种类，会回退为全量扫描所有普通容器，
 *   扫描结果会被写入索引，后续同种类物品的分拣走快速路径。
 * - **容错性**：每个输入容器的处理都在 try-catch 中，单个容器不可达（区块未加载、
 *   方块被破坏等）不会影响其他容器的分拣。
 */
export class SorterEngine {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly runtime: WarehouseRuntimeRegistry
  ) {}

  // ─── 公开入口 ───────────────────────────────────────────────────

  /**
   * 处理指定仓库的下一轮分拣。
   *
   * 执行流程：
   * 1. 从仓库仓库（Repository）加载仓库数据。
   * 2. 检查仓库是否启用，若禁用则静默跳过。
   * 3. 构建或获取运行态模型（RuntimeModel），若构建失败则跳过。
   * 4. 若没有输入容器，直接返回。
   * 5. **轮询调度**：通过 `inputCursor` 游标选取当前输入容器，并前进游标。
   * 6. 调用 `processInputContainer` 处理该输入容器的第一个非空物品堆。
   *
   * @param warehouseId - 要处理的仓库 ID
   */
  processWarehouse(warehouseId: WarehouseId): void {
    const warehouse = this.repository.load(warehouseId);
    if (!warehouse) {
      log.error(`仓库 ${warehouseId} 未找到，跳过`);
      return;
    }

    // 仓库被禁用时不处理，静默跳过
    if (!warehouse.settings.enabled) {
      return;
    }

    const model = this.runtime.getOrBuild(warehouseId);
    if (!model) {
      log.error(`仓库 ${warehouseId} 的运行态模型构建失败，跳过`);
      return;
    }

    // 没有输入容器则无事可做
    if (model.inputContainerIds.length === 0) return;

    // 轮询调度：取模选取当前输入容器，游标 +1，实现多个输入容器间的负载均衡
    const inputIndex = model.inputCursor % model.inputContainerIds.length;
    const inputContainerId = model.inputContainerIds[inputIndex];
    model.inputCursor = (model.inputCursor + 1) % model.inputContainerIds.length;

    this.processInputContainer(warehouse, model, inputContainerId);
  }

  // ─── 输入容器处理 ───────────────────────────────────────────────

  /**
   * 处理单个输入容器的分拣。
   *
   * 遍历容器中所有槽位，逐个尝试分拣。无法分类的物品**留在原地**，
   * 不会阻塞后续槽位的处理，且下个 tick 会再次尝试。
   *
   * 步骤（每个槽位）：
   * 1. 获取该槽位的物品堆。
   * 2. 调用 `moveStackIntoWarehouse` 尝试放入仓库中的存储容器。
   * 3. 根据返回值更新槽位：
   *    - `undefined`：整堆全部放完 → 清空槽位。
   *    - 剩余量 < 原来量 → 部分放入，余量写回槽位。
   *    - 剩余量 == 原来量 → 无法分类，保持不动，继续下一槽。
   *
   * **容错设计**：整个方法被 try-catch 包裹，确保单个容器异常不会瓦解调度循环。
   */
  private processInputContainer(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    containerId: ContainerId
  ): void {
    try {
      const stored = warehouse.containers[containerId];
      if (!stored) {
        log.error(`容器 ${containerId} 未在仓库 ${warehouse.id} 中找到`);
        return;
      }

      const dimension = this.getDimensionSafe(stored.dimensionId);
      if (!dimension) return;

      const container = getContainerFromStored(dimension, stored);
      if (!container) return;

      const loc = stored.primaryLocation;

      // 遍历所有槽位，无法分类的物品不阻塞后续槽位
      for (let slot = 0; slot < container.size; slot++) {
        const stack = container.getItem(slot);
        if (!stack) continue; // 空槽位，跳过

        const originalAmount = stack.amount;

        const remaining = this.moveStackIntoWarehouse(stack, warehouse, model, dimension);

        if (remaining === undefined) {
          // 整堆全部成功放置 → 清空输入槽位
          try {
            container.setItem(slot);
            log.info(`槽位 ${slot} 已清空（${stack.typeId} x${originalAmount} 已放置）`);
          } catch (setError) {
            // setItem 失败极罕见（容器被破坏/区块卸载），
            // 但一旦发生会导致物品已移到目标但输入槽未清空。
            // 记录致命错误以便管理员发现。
            log.error(`致命错误：槽位 ${slot} 清空失败，物品已在目标容器中但输入槽未清空: ${setError}`);
          }
        } else if (remaining.amount < originalAmount) {
          // 部分放置成功 → 余量写回槽位
          try {
            container.setItem(slot, remaining);
            log.info(
              `槽位 ${slot} 部分放置：${remaining.amount}/${originalAmount} ${stack.typeId} 返回`
            );
          } catch (setError) {
            log.error(`致命错误：槽位 ${slot} 回写失败，剩余 ${remaining.amount} 个物品已丢失: ${setError}`);
          }
        }
        // 无法分类 → 保持不动，遍历下一个槽位
      }
    } catch (error) {
      log.error(`处理输入容器 ${containerId} 时出错: ${error}`);
    }
  }

  // ─── 目标选择与转移 ─────────────────────────────────────────────

  /**
   * 按优先级尝试将物品堆放入仓库中的目标容器。
   *
   * 优先级顺序：
   * 1. **已有同类物品的普通容器** —— 通过 `findExistingTypeContainers` 查找，
   *    利用运行时索引加速。
   * 2. **空的普通容器** —— 当 `autoCreateCategories` 开启时启用，用于自动创建新分类。
   *    筛选出所有空的普通容器依次尝试。
   * 3. **杂项容器** —— 兜底方案，任何物品最终都能放入杂项容器。
   *
   * 每一优先级都会调用 `tryContainers` 遍历候选容器列表并尝试放入。
   * 一旦整堆全部放完（返回 undefined），立即返回，不再尝试后续优先级。
   *
   * @param stack - 待放置的物品堆
   * @param warehouse - 仓库数据
   * @param model - 运行态模型（包含索引、容器分类列表等）
   * @param dimension - 物品所在的维度
   * @returns 未能放入的剩余物品堆，全部放完则返回 undefined
   */
  private moveStackIntoWarehouse(
    stack: ItemStack,
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension
  ): ItemStack | undefined {
    const typeId = stack.typeId;
    let remaining: ItemStack | undefined = stack;

    // 优先级 1：已有同类物品的普通容器
    const existingTypeContainers = this.findExistingTypeContainers(warehouse, model, typeId, dimension);
    remaining = this.tryContainers(remaining, existingTypeContainers, warehouse, model, dimension, typeId, "match");
    if (remaining === undefined) return undefined;

    // 优先级 2：空的普通容器（自动创建分类）
    if (warehouse.settings.autoCreateCategories) {
      const emptyNormalIds = model.normalContainerIds.filter((id) => {
        const stored = warehouse.containers[id];
        if (!stored) return false;
        const targetContainer = getContainerFromStored(dimension, stored);
        return targetContainer !== undefined && isContainerEmpty(targetContainer);
      });
      remaining = this.tryContainers(remaining, emptyNormalIds, warehouse, model, dimension, typeId, "autocreate");
      if (remaining === undefined) return undefined;
    }

    // 优先级 3：杂项容器（兜底）
    remaining = this.tryContainers(remaining, model.miscContainerIds, warehouse, model, dimension, typeId, "misc");
    return remaining; // 返回 undefined 表示最后一个容器处理完了全部
  }

  /**
   * 遍历候选容器列表，尝试将剩余物品堆放入每个容器。
   *
   * 对每个容器：
   * - 获取其 `StoredContainer` 信息，跳过数据缺失的容器。
   * - 通过 `getContainerFromStored` 获取方块容器对象，若不可达则跳过并记录日志。
   * - 调用 `tryMoveStackIntoContainer` 尝试将物品放入容器。
   * - 若有物品成功放入（`placed > 0`），则将容器 ID 更新到 `itemTypeIndex` 索引中，
   *   以便未来同类物品的分拣能快速定位到该容器。
   * - 如果剩余物品全部放完（`remaining === undefined`），提前终止遍历。
   *
   * @param stack - 当前待放置的物品堆（undefined 表示已放完）
   * @param containerIds - 候选容器 ID 列表
   * @param warehouse - 仓库数据
   * @param model - 运行态模型
   * @param dimension - 维度
   * @param typeId - 物品类型 ID
   * @param tag - 日志标签，用于区分不同优先级（match / autocreate / misc）
   * @returns 剩余的物品堆，全部放完则返回 undefined
   */
  private tryContainers(
    stack: ItemStack | undefined,
    containerIds: ContainerId[],
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension,
    typeId: string,
    tag?: string
  ): ItemStack | undefined {
    if (!stack) return undefined;

    let remaining: ItemStack | undefined = stack;

    for (const containerId of containerIds) {
      const stored = warehouse.containers[containerId];
      if (!stored) continue;
      const loc = stored.primaryLocation;

      const targetContainer = getContainerFromStored(dimension, stored);
      if (!targetContainer) {
        log.info(`[${tag ?? "?"}] ${containerId} @ (${loc.x},${loc.y},${loc.z}) — 容器不可达，跳过`);
        continue;
      }

      const beforeAmount = remaining.amount;
      remaining = tryMoveStackIntoContainer(remaining, targetContainer);

      const placed = beforeAmount - (remaining?.amount ?? 0);
      if (placed > 0) {
        log.info(
          `[${tag ?? "?"}] ${typeId} x${placed} → ${containerId} (角色=${stored.role}) @ (${loc.x},${loc.y},${loc.z})`
        );
        // 记录索引，下回同类物品快速定位到此容器
        this.addToTypeIndex(model, typeId, containerId);
      }

      if (remaining === undefined) return undefined; // 全部放完，提前退出
    }

    return remaining;
  }

  // ─── itemTypeIndex 索引辅助方法 ────────────────────────────────

  /**
   * 查找当前仓库中已包含指定物品类型的普通容器。
   *
   * **核心设计 —— 索引自愈机制（Index Self-Healing）：**
   *
   * 为了提高分拣效率，运行态维护了一个 `itemTypeIndex` 字典，
   * 键为物品类型 ID，值为包含该物品的普通容器 ID 列表。
   *
   * 但由于容器内的物品可能被玩家取走、容器被破坏或替换，
   * 索引可能变得"脏"（stale）。本方法采用**惰性校验 + 自动修复**策略：
   *
   * ┌─ 快速路径（有索引记录）─────────────────────────────────────┐
   * │ 1. 从 `itemTypeIndex` 取出候选容器列表。                       │
   * │ 2. 对每个候选容器校验：                                      │
   * │    - 容器数据仍存在且角色仍为 "normal" → 继续。              │
   * │    - 容器方块可访问且确实包含该类型 → 加入有效列表。         │
   * │    - 容器方块可访问但不包含该类型 → 标记为脏数据。           │
   * │    - 容器方块不可达（区块未加载）→ 保留在索引但本次跳过。    │
   * │ 3. 若有脏数据，从索引中清除，若某类型下所有容器都被清空      │
   * │    则删除该索引条目。                                        │
   * └──────────────────────────────────────────────────────────────┘
   *
   * ┌─ 回退路径（无索引记录）─────────────────────────────────────┐
   * │ 1. 全量扫描 `model.normalContainerIds` 中的所有容器。        │
   * │ 2. 找出实际包含该物品类型的容器。                            │
   * │ 3. 将结果写回 `itemTypeIndex`，后续同类物品走快速路径。      │
   * └──────────────────────────────────────────────────────────────┘
   *
   * 这种设计的好处：
   * - 索引无需在物品变化时实时同步，避免了复杂的事件监听。
   * - 脏数据最多影响一次查询性能（这次多校验几个无效容器），不会导致错误。
   * - 全量扫描的结果会被"学习"到索引中，后续分拣越来越快。
   *
   * @param warehouse - 仓库数据
   * @param model - 运行态模型（含 itemTypeIndex）
   * @param typeId - 物品类型 ID
   * @param dimension - 维度
   * @returns 当前实际包含该物品类型的普通容器 ID 列表
   */
  private findExistingTypeContainers(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    typeId: string,
    dimension: Dimension
  ): ContainerId[] {
    // 判断是否有现成的索引记录
    const hasIndexEntry = model.itemTypeIndex.has(typeId);
    // 有索引走快速路径（候选集较小），否则全量扫描所有普通容器
    const candidates = hasIndexEntry ? model.itemTypeIndex.get(typeId)! : model.normalContainerIds;

    const valid: ContainerId[] = [];
    const stale = new Set<ContainerId>();

    for (const containerId of candidates) {
      const stored = warehouse.containers[containerId];
      // 容器记录不存在或角色不再是 "normal" → 只有在索引路径下才标记为脏
      if (!stored || stored.role !== "normal") {
        if (hasIndexEntry) stale.add(containerId);
        continue;
      }

      const container = getContainerFromStored(dimension, stored);
      if (!container) {
        // 容器方块暂时不可达（区块未加载）—— 如果是索引路径则保留在索引中，
        // 但本次不将该容器纳入有效列表（避免因暂时不可达而错误清理索引）。
        if (hasIndexEntry) valid.push(containerId);
        continue;
      }

      if (containerHasType(container, typeId)) {
        valid.push(containerId);
      } else if (hasIndexEntry) {
        // 容器可达但不包含该类物品 → 索引已过时，标记为脏
        stale.add(containerId);
      }
      // 回退路径下的候选容器即使不匹配也不标记为脏
      // （因为它们本来就不在索引中，不存在"脏"的概念）
    }

    // 惰性清除索引中的脏条目
    if (hasIndexEntry && stale.size > 0) {
      const updated = candidates.filter((id) => !stale.has(id));
      if (updated.length > 0) {
        model.itemTypeIndex.set(typeId, updated);
      } else {
        // 该类型的所有容器都脏了，删除整个条目
        model.itemTypeIndex.delete(typeId);
      }
    }

    // ── 关键修复：索引全部过期后的全量回退扫描 ──────────────
    // 场景：玩家把圆石从 normal 箱 A 移到 normal 箱 B。
    //       索引指向 A（{"cobblestone":["A"]}），但 A 已无圆石。
    //       上述逻辑会删除索引条目，然后返回空列表。
    //       此时物品会错误地落入杂项箱。
    //
    // 修复：索引被清空后，立即全量扫描所有 normal 容器，
    //       找出物品实际所在的箱子，从而做到**零回合延迟**。
    if (hasIndexEntry && stale.size > 0 && valid.length === 0) {
      for (const containerId of model.normalContainerIds) {
        // 跳过已在候选列表（已检查过）的容器
        if (candidates.includes(containerId)) continue;
        const stored = warehouse.containers[containerId];
        if (!stored || stored.role !== "normal") continue;
        const container = getContainerFromStored(dimension, stored);
        if (!container) continue;
        if (containerHasType(container, typeId)) {
          valid.push(containerId);
        }
      }
      // 将新发现的结果写回索引，下次走快速路径
      if (valid.length > 0) {
        model.itemTypeIndex.set(typeId, [...valid]);
      }
    }

    // 回退路径下发现的新容器写回索引，下次同类物品分拣走快速路径
    if (!hasIndexEntry && valid.length > 0) {
      model.itemTypeIndex.set(typeId, [...valid]);
    }

    return valid;
  }

  /**
   * 将容器 ID 记录到运行时物品类型索引中，避免重复添加。
   *
   * 在 `tryContainers` 中每当有物品成功放入某个容器时调用，
   * 以便后续同类物品的分拣能通过索引快速定位到该容器。
   *
   * @param model - 运行态模型
   * @param typeId - 物品类型 ID
   * @param containerId - 容器 ID
   */
  private addToTypeIndex(model: WarehouseRuntimeModel, typeId: string, containerId: ContainerId): void {
    const existing = model.itemTypeIndex.get(typeId);
    if (existing) {
      if (!existing.includes(containerId)) {
        existing.push(containerId);
      }
    } else {
      model.itemTypeIndex.set(typeId, [containerId]);
    }
  }

  // ─── 工具方法 ──────────────────────────────────────────────────

  /**
   * 安全获取维度对象，避免因维度 ID 无效而抛出异常。
   *
   * @param dimensionId - 维度 ID（如 "overworld"、"nether"、"the_end"）
   * @returns 维度对象，获取失败时返回 undefined
   */
  private getDimensionSafe(dimensionId: string): Dimension | undefined {
    try {
      return world.getDimension(dimensionId);
    } catch {
      return undefined;
    }
  }
}
