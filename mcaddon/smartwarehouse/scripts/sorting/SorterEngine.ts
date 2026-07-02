import { world, system, Dimension, ItemStack } from "@minecraft/server";
import type { WarehouseData, WarehouseId, WarehouseRuntimeModel, WarehouseArea, ContainerId } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { WarehouseRuntimeRegistry } from "../runtime/WarehouseRuntimeRegistry";
import { Logger } from "../util/Logger";
import {
  getContainerFromStored,
  containerHasType,
  isContainerEmpty,
  tryMoveStackIntoContainer,
  isShulkerBoxItem,
  getBulkChestFirstType,
  tryFillShulkerBoxes,
} from "./ContainerInventory";
import { playSortEffect } from "./SortEffects";
import { SlotOrganizer } from "./SlotOrganizer";
import { getFamily, getFamilyById } from "../data/ItemFamilies";

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
 * 2. **大宗容器**（盒箱混存——优先填满箱内潜影盒，再填充空槽位，以第一个物品确定种类）。
 *    放大宗前放家庭前：高产量单品（如白色羊毛）应优先路由到专用大宗箱，
 *    而不是与少量彩色羊毛一起混入家庭箱。
 * 3. **同族物品的普通容器**（仅当该物品所属的族在 `enabledFamilies` 中启用时生效，
 *    将同一族的物品聚集到同一个容器中）。
 * 4. **空的普通容器**（仅在 `autoCreateCategories` 开启时启用，用于自动创建新分类）。
 * 5. **杂项容器**（兜底，任何物品最终都能放入杂项容器）。
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
    private readonly runtime: WarehouseRuntimeRegistry,
    private readonly organizer?: SlotOrganizer
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

    // 区块加载预检：每 40 tick（~2 秒）采样仓库区域角落，
    // 如果任何角落位于未加载区块，跳过本次分拣
    this.checkAreaLoaded(warehouse, model);
    if (model.areaLoaded === false) {
      return; // 区块未加载，静默跳过，下个周期重试
    }

    // 轮询调度：取模选取当前输入容器，游标 +1，实现多个输入容器间的负载均衡
    const inputIndex = model.inputCursor % model.inputContainerIds.length;
    const inputContainerId = model.inputContainerIds[inputIndex];
    model.inputCursor = (model.inputCursor + 1) % model.inputContainerIds.length;

    this.processInputContainer(warehouse, model, inputContainerId);
  }

  // ─── 区块加载预检 ──────────────────────────────────────────────

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
   * @param warehouse - 仓库数据（含区域信息）
   * @param model - 运行时模型（含缓存字段）
   */
  private checkAreaLoaded(warehouse: WarehouseData, model: WarehouseRuntimeModel): void {
    // 缓存有效期 40 tick ≈ 2 秒，避免每 tick 重复采样
    const RECHECK_INTERVAL = 40;
    if (
      model.areaLoaded !== undefined &&
      system.currentTick - model.areaLoadedCheckedTick < RECHECK_INTERVAL
    ) {
      return; // 缓存仍有效
    }

    const dimension = this.getDimensionSafe(warehouse.dimensionId);
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

      // ── 槽位游标：取当前格 ──
      let slot = model.inputSlotCursors.get(containerId) ?? 0;
      if (slot >= container.size) slot = 0;

      // 如果当前格为空，直接跳到下一个非空槽（不浪费 interval）
      const stack = container.getItem(slot);
      if (!stack) {
        const nextSlot = this.findNextNonEmptySlot(container, slot);
        model.inputSlotCursors.set(containerId, nextSlot);
        return;
      }

      const originalAmount = stack.amount;
      log.info(`槽 ${slot}：${stack.typeId} x${originalAmount}`);

      const remaining = this.moveStackIntoWarehouse(stack, warehouse, model, dimension);

      if (remaining === undefined) {
        // 整堆全部成功放置 → 清空输入槽位
        try {
          container.setItem(slot);
          log.info(`槽 ${slot} 已清空（全部 ${originalAmount} 个已放置）`);
        } catch (setError) {
          log.error(`致命错误：槽 ${slot} 清空失败，物品已在目标容器但输入槽未清空: ${setError}`);
        }
      } else if (remaining.amount < originalAmount) {
        // 部分放置成功 → 余量写回槽位
        try {
          container.setItem(slot, remaining);
          log.info(`槽 ${slot} 部分放置：${remaining.amount}/${originalAmount} 返回`);
        } catch (setError) {
          log.error(`致命错误：槽 ${slot} 回写失败，剩余 ${remaining.amount} 个物品已丢失: ${setError}`);
        }
      } else {
        log.info(`槽 ${slot} 无法分类（${originalAmount} 个未变动）`);
      }

      // 无论结果如何，游标 +1（回绕），不阻塞
      model.inputSlotCursors.set(containerId, (slot + 1) % container.size);
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
   * 2. **大宗容器** —— 高产量单品优先路由到专用大宗箱。
   * 3. **同族物品的普通容器** —— 同一家族（如各色羊毛）聚集到同一容器。
   * 4. **空的普通容器** —— 当 `autoCreateCategories` 开启时启用，用于自动创建新分类。
   * 5. **杂项容器** —— 兜底方案，任何物品最终都能放入杂项容器。
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

    // 优先级 2：大宗容器（盒箱混存）
    // 放大宗前放家庭前：高产量单品（如白色羊毛）应优先路由到专用大宗箱。
    // 大宗箱以第一个有效物品的种类为准，同时匹配箱内散装和盒内物品。
    // 空箱接受任何第一个放入的物品以设定种类。
    //
    // ── 设计笔记：大宗 > 家庭的优先级决策 ──────────────────────
    //
    // 场景：白色羊毛量产数百倍于有色羊毛。
    //       大宗箱专收白色羊毛，家庭箱收各色羊毛。
    //       大宗优先 → 白色羊毛按精确类型进大宗，
    //                  有色羊毛因 bulk 不匹配 fallthrough 到家庭。
    //       家庭优先 → 白色羊毛被「羊毛家庭」截胡进家庭箱，
    //                  大宗箱永远收不到白色羊毛。
    //
    // 结论：大宗 > 家庭。单品大宗需求优先于同族聚集。
    // 副作用：该族首个非大宗物品需要 autoCreate/misc 兜底
    //        （家族冷启动问题，不影响正确性）。
    // ───────────────────────────────────────────────────────────
    //
    // 设计笔记：大宗箱不走 itemTypeIndex 而是每次都全量扫描
    // `model.bulkContainerIds`。原因是 bulk 数量极少（典型场景 1-5），
    // 硬扫成本远低于索引维护（脏数据检测、惰性清除、回退扫描的复杂度）。
    // 索引在 normal 箱数量大（几十上百）时有巨大收益，在 bulk 箱上收益为负。
    const bulkMatches = model.bulkContainerIds.filter((id) => {
      const stored = warehouse.containers[id];
      if (!stored) return false;
      const target = getContainerFromStored(dimension, stored);
      if (!target) return false;
      if (isContainerEmpty(target)) return true;
      return getBulkChestFirstType(target) === typeId;
    });
    remaining = this.tryBulkContainers(remaining, bulkMatches, warehouse, model, dimension, typeId);
    if (remaining === undefined) return undefined;

    // 优先级 3：同族物品的普通容器
    // 检查物品是否属于已启用的同族分类，若是则将同族物品聚集到同一容器。
    // 放在大宗之后：白色羊毛等高产量单品应优先流入大宗箱而非家庭箱。
    const family = getFamily(typeId);
    const enabledFamilies = warehouse.settings.enabledFamilies ?? [];
    if (family && enabledFamilies.includes(family.id)) {
      const familyContainers = this.findExistingFamilyContainers(warehouse, model, family.id, dimension);
      remaining = this.tryContainers(remaining, familyContainers, warehouse, model, dimension, typeId, "family");
      if (remaining === undefined) return undefined;
    }

    // 优先级 4：空的普通容器（自动创建分类）

    // 优先级 4：杂项容器（兜底）
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
        // 如果物品属于某个启用的同族分类，同步更新 familyTypeIndex
        const placedFamily = getFamily(typeId);
        if (placedFamily && (warehouse.settings.enabledFamilies ?? []).includes(placedFamily.id)) {
          this.addToFamilyIndex(model, placedFamily.id, containerId);
        }
        // 播放分拣动画（粒子 + 音效）
        playSortEffect(dimension, stored.occupiedLocations, stored.role);
        // 触发目标容器的混乱度检查，必要时自动整理
        this.organizer?.onDeposit(targetContainer, containerId, warehouse.settings.autoSortThreshold / 100);
      }

      if (remaining === undefined) return undefined; // 全部放完，提前退出
    }

    return remaining;
  }

  /**
   * 尝试将物品放入大宗容器中。
   *
   * 大宗容器的插入逻辑与普通容器不同：
   * 1. **优先填满箱内已有的潜影盒** —— 遍历容器槽位，对每个潜影盒调用
   *    `tryFillShulkerBoxes`，将物品放入盒内。
   * 2. **再填充空槽位** —— 调用 `tryMoveStackIntoContainer` 放入散装空间。
   *
   * 此类容器专用于单一物品类型，混合存储潜影盒与散装物品。
   *
   * 设计笔记：本方法不走 `itemTypeIndex` 也不向索引写入。原因是：
   * - `findExistingTypeContainers` 在 :508 行以 `role !== "normal"` 过滤了 bulk。
   * - bulk 容器数量极少（~1-5），每次全量扫描的成本远低于索引自愈的复杂度。
   * - 索引是 normal 箱在数量大时的优化手段，对 bulk 箱收益为负。
   *
   * @param stack - 当前待放置的物品堆
   * @param containerIds - 候选大宗容器 ID 列表
   * @param warehouse - 仓库数据
   * @param model - 运行态模型
   * @param dimension - 维度
   * @param typeId - 物品类型 ID
   * @returns 剩余的物品堆，全部放完则返回 undefined
   */
  private tryBulkContainers(
    stack: ItemStack | undefined,
    containerIds: ContainerId[],
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension,
    typeId: string,
  ): ItemStack | undefined {
    if (!stack) return undefined;

    let remaining: ItemStack | undefined = stack;

    for (const containerId of containerIds) {
      if (remaining === undefined) return undefined;

      const stored = warehouse.containers[containerId];
      if (!stored) continue;
      const loc = stored.primaryLocation;

      const target = getContainerFromStored(dimension, stored);
      if (!target) {
        log.info(`[bulk] ${containerId} @ (${loc.x},${loc.y},${loc.z}) — 容器不可达，跳过`);
        continue;
      }

      const beforeAmount = remaining.amount;

      // 第 1 步：优先填入箱内已有的潜影盒
      remaining = tryFillShulkerBoxes(target, remaining);
      if (remaining === undefined) {
        playSortEffect(dimension, stored.occupiedLocations, stored.role);
        this.organizer?.onDeposit(target, containerId, warehouse.settings.autoSortThreshold / 100);
        return undefined;
      }

      // 第 2 步：剩余物品填入空槽位（散装）
      remaining = tryMoveStackIntoContainer(remaining, target);

      const placed = beforeAmount - (remaining?.amount ?? 0);
      if (placed > 0) {
        log.info(
          `[bulk] ${typeId} x${placed} → ${containerId} @ (${loc.x},${loc.y},${loc.z})`
        );
        playSortEffect(dimension, stored.occupiedLocations, stored.role);
        this.organizer?.onDeposit(target, containerId, warehouse.settings.autoSortThreshold / 100);
      }

      if (remaining === undefined) return undefined;
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
      if (!stored || stored.role !== "normal" || !stored.enabled) {
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
        if (!stored || stored.role !== "normal" || !stored.enabled) continue;
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
   * 查找已包含指定同族物品的普通容器。
   *
   * 当物品属于某个已启用的同族分类时，根据 `familyTypeIndex` 查找已有同类族物品的容器，
   * 使得同族物品（如各色羊毛）能够自动聚集到同一容器中。
   *
   * @param warehouse - 仓库数据
   * @param model     - 运行态模型
   * @param familyId  - 同族分类 ID
   * @param dimension - 维度
   * @returns 候选容器 ID 列表
   */
  private findExistingFamilyContainers(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    familyId: string,
    dimension: Dimension
  ): ContainerId[] {
    const family = getFamilyById(familyId);
    if (!family) return [];

    const candidates = model.familyTypeIndex.get(familyId);
    const hasIndex = candidates !== undefined && candidates.length > 0;

    const valid: ContainerId[] = [];
    const stale = new Set<ContainerId>();

    // ── 有索引：检查索引项，标记过期 ──────────────
    if (hasIndex) {
      for (const containerId of candidates) {
        const stored = warehouse.containers[containerId];
        if (!stored || stored.role !== "normal" || !stored.enabled) {
          stale.add(containerId);
          continue;
        }

        const container = getContainerFromStored(dimension, stored);
        if (!container) {
          valid.push(containerId);
          continue;
        }

        let hasFamilyItem = false;
        for (const typeId of family.items) {
          if (containerHasType(container, typeId)) {
            hasFamilyItem = true;
            break;
          }
        }

        if (hasFamilyItem) {
          valid.push(containerId);
        } else {
          stale.add(containerId);
        }
      }

      // 惰性清除脏索引
      if (stale.size > 0) {
        const updated = candidates.filter((id) => !stale.has(id));
        if (updated.length > 0) {
          model.familyTypeIndex.set(familyId, updated);
        } else {
          model.familyTypeIndex.delete(familyId);
        }
      }
    }

    // ── 回退 / 初始全量扫描 ─────────────────────────
    // 场景 A（初始）：索引为空，手工放入的家族物品从未被分拣引擎发现
    // 场景 B（回退）：索引被清空后，全量扫描重建
    const needsFullScan = !hasIndex || (valid.length === 0 && stale.size > 0);
    if (!needsFullScan) return valid;

    for (const containerId of model.normalContainerIds) {
      // 跳过已检查过的容器
      if (hasIndex && candidates.includes(containerId)) continue;
      const stored = warehouse.containers[containerId];
      if (!stored || stored.role !== "normal" || !stored.enabled) continue;
      const container = getContainerFromStored(dimension, stored);
      if (!container) continue;
      for (const typeId of family.items) {
        if (containerHasType(container, typeId)) {
          valid.push(containerId);
          break;
        }
      }
    }

    // 将扫描结果写回索引，下次走快速路径
    if (valid.length > 0) {
      model.familyTypeIndex.set(familyId, [...valid]);
    }

    return valid;
  }

  /**
   * 将容器 ID 记录到运行时同族分类索引中。
   *
   * @param model       - 运行态模型
   * @param familyId    - 同族分类 ID
   * @param containerId - 容器 ID
   */
  private addToFamilyIndex(model: WarehouseRuntimeModel, familyId: string, containerId: ContainerId): void {
    const existing = model.familyTypeIndex.get(familyId);
    if (existing) {
      if (!existing.includes(containerId)) {
        existing.push(containerId);
      }
    } else {
      model.familyTypeIndex.set(familyId, [containerId]);
    }
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
  /**
   * 从指定槽位开始查找下一个非空槽位。
   * 绕回遍历所有槽位，如果全空则返回 0（没找到也无妨，下次还会触发空槽检测）。
   */
  private findNextNonEmptySlot(container: import("@minecraft/server").Container, startSlot: number): number {
    for (let i = 1; i < container.size; i++) {
      const checkSlot = (startSlot + i) % container.size;
      const item = container.getItem(checkSlot);
      if (item) return checkSlot;
    }
    return (startSlot + 1) % container.size; // 全空，简单前进
  }

  private getDimensionSafe(dimensionId: string): Dimension | undefined {
    try {
      return world.getDimension(dimensionId);
    } catch {
      return undefined;
    }
  }
}
