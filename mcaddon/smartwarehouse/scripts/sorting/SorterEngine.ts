import { world, system, Dimension, ItemStack, Container } from "@minecraft/server";
import type { WarehouseData, WarehouseId, WarehouseRuntimeModel, WarehouseArea, ContainerId } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { WarehouseRuntimeRegistry } from "../runtime/WarehouseRuntimeRegistry";
import { Logger } from "../util/Logger";
import {
  getContainerFromStored,
  containerHasType,
  isContainerEmpty,
  tryMoveStackIntoContainer,
  tryMoveStackIntoContainerWithJournal,
  isShulkerBoxItem,
  getBulkChestFirstType,
  tryFillShulkerBoxes,
  getFamilyPurity,
} from "./ContainerInventory";
import { MoveJournal } from "./MoveJournal";
import { playSortEffect } from "./SortEffects";
import { SlotOrganizer } from "./SlotOrganizer";
import { getFamily, getFamilyById } from "../data/ItemFamilies";
import { isContainerFull, refreshContainerStats } from "../ui/WarehouseStats";
import { isNearAreaXZ } from "../util/Vector";

const log = new Logger("SorterEngine");

/** 容量预警冷却 tick 数（5 秒 = 100 tick，防止刷屏） */
const CAPACITY_WARNING_COOLDOWN_TICKS = 100;

/**
 * 分拣引擎 —— 将物品从输入容器分拣到对应的存储容器（普通 / 杂项）中。
 *
 * ### 分拣优先级（每个物品堆）
 *
 * 按照以下优先级依次尝试放置物品：
 *
 * 1. **大宗容器**（单物品——专收单一类型高产量物品，盒箱混存。空箱需玩家配置 bulkTypeId）
 * 2. **已有同类物品的普通容器**（多物品——优先利用运行时 `itemTypeIndex` 索引快速查找）
 * 3. **同族物品的普通容器**（家庭同族——仅当物品所属族在 `enabledFamilies` 中启用时生效）
 * 4. **空的普通容器**（自动创建分类——仅在 `autoCreateCategories` 开启时启用）
 * 5. **杂项容器**（兜底，任何物品最终都能放入杂项容器）
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
  /** 容量预警冷却：容器 ID → 上次预警 tick */
  private readonly warningCooldowns = new Map<string, number>();

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

  /**
   * 释放指定仓库的运行时模型，回收内存。
   * 由 SortingScheduler 在仓库停用时调用。
   */
  releaseRuntime(warehouseId: WarehouseId): void {
    this.runtime.delete(warehouseId);
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
    if (model.areaLoaded !== undefined && system.currentTick - model.areaLoadedCheckedTick < RECHECK_INTERVAL) {
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
    const journal = new MoveJournal();
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

      const remaining = this.moveStackIntoWarehouse(stack, warehouse, model, dimension, journal);

      if (remaining === undefined) {
        // 整堆全部成功放置 → 清空输入槽位
        try {
          container.setItem(slot);
          log.info(`槽 ${slot} 已清空（全部 ${originalAmount} 个已放置）`);
        } catch (setError) {
          log.error(`致命错误：槽 ${slot} 清空失败，尝试回滚: ${setError}`);
          const rollResult = journal.rollback();
          if (rollResult.ok) {
            this.runtime.markDirty(warehouse.id);
            log.info(`回滚成功，已撤销本次分拣对目标容器的写入`);
          } else {
            warehouse.settings.enabled = false;
            this.repository.saveMetaOnly(warehouse);
            log.error(`仓库 ${warehouse.id} 已因分拣回滚失败而停用: ${rollResult.error}`);
          }
        }
      } else if (remaining.amount < originalAmount) {
        // 部分放置成功 → 余量写回槽位
        try {
          container.setItem(slot, remaining);
          log.info(`槽 ${slot} 部分放置：${remaining.amount}/${originalAmount} 返回`);
        } catch (setError) {
          log.error(`致命错误：槽 ${slot} 回写失败，尝试回滚: ${setError}`);
          const rollResult = journal.rollback();
          if (rollResult.ok) {
            this.runtime.markDirty(warehouse.id);
            log.info(`回滚成功，已撤销本次分拣对目标容器的写入`);
          } else {
            warehouse.settings.enabled = false;
            this.repository.saveMetaOnly(warehouse);
            log.error(`仓库 ${warehouse.id} 已因分拣回滚失败而停用: ${rollResult.error}`);
          }
        }
      } else {
        log.info(`槽 ${slot} 无法分类（${originalAmount} 个未变动）`);
      }

      // 无论结果如何，游标 +1（回绕），不阻塞
      model.inputSlotCursors.set(containerId, (slot + 1) % container.size);
    } catch (error) {
      log.error(`处理输入容器 ${containerId} 时出错: ${error}`);
      // 尝试回滚已记录的目标容器
      const rollResult = journal.rollback();
      if (rollResult.ok) {
        this.runtime.markDirty(warehouse.id);
        log.info(`回滚成功，已撤销本次分拣对目标容器的写入`);
      } else {
        warehouse.settings.enabled = false;
        this.repository.saveMetaOnly(warehouse);
        log.error(`仓库 ${warehouse.id} 已因回滚失败而停用: ${rollResult.error}`);
      }
    }
  }

  // ─── 目标选择与转移 ─────────────────────────────────────────────

  /**
   * 按优先级尝试将物品堆放入仓库中的目标容器。
   *
   * 优先级顺序：
   * 1. **大宗容器**（单物品）—— 高产量单品优先路由到专用大宗箱。
   * 2. **已有同类物品的普通容器**（多物品）—— 利用运行时索引加速。
   * 3. **同族物品的普通容器**（家庭同族）—— 同一家族聚集到同一容器。
   * 4. **空的普通容器**（自动创建分类）—— 当 `autoCreateCategories` 开启时启用。
   * 5. **杂项容器**（兜底）—— 任何物品最终都能放入杂项容器。
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
    dimension: Dimension,
    journal: MoveJournal
  ): ItemStack | undefined {
    const typeId = stack.typeId;
    let remaining: ItemStack | undefined = stack;

    // ── 优先级 1：单物品（大宗）────────────────────────────────
    // 大宗容器专收单一类型高产量物品，匹配规则：
    //   - 非空箱：匹配箱内已有物品种类
    //   - 空箱：不接收物品，玩家需手动放入第一件物品来设定种类
    //
    // 注意：大宗 > 普通。专用大宗箱应优先拦截高产量单品（如白色羊毛），
    // 避免被多物品普通箱截胡，剩余的散品再 fallthrough 给后续优先级处理。
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
      if (isContainerEmpty(target)) return false; // 空箱需玩家手动放入第一件物品
      return getBulkChestFirstType(target) === typeId;
    });
    remaining = this.tryBulkContainers(remaining, bulkMatches, warehouse, model, dimension, typeId, journal);
    if (remaining === undefined) return undefined;

    // ── 优先级 2：多物品（普通）────────────────────────────────
    // 已有同类物品的普通容器，用于多物品混合分类。
    // 放在大宗之后：大宗拦截高产量单品后，剩余散品走普通分类。
    const existingTypeContainers = this.findExistingTypeContainers(warehouse, model, typeId, dimension);
    remaining = this.tryContainers(
      remaining,
      existingTypeContainers,
      warehouse,
      model,
      dimension,
      typeId,
      journal,
      "match"
    );
    if (remaining === undefined) return undefined;

    // ── 优先级 3：家庭同族 ──────────────────────────────────────
    // 检查物品是否属于已启用的同族分类，若是则将同族物品聚集到同一容器。
    // 放在大宗和普通之后：确保专用分类优先，同族聚集作为兜底归类手段。
    const family = getFamily(typeId);
    const enabledFamilies = warehouse.settings.enabledFamilies ?? [];
    if (family && enabledFamilies.includes(family.id)) {
      const familyContainers = this.findExistingFamilyContainers(warehouse, model, family.id, dimension);
      remaining = this.tryContainers(
        remaining,
        familyContainers,
        warehouse,
        model,
        dimension,
        typeId,
        journal,
        "family"
      );
      if (remaining === undefined) return undefined;
    }

    // ── 优先级 4：自动创建分类 ────────────────────────────────
    // 当开启 autoCreateCategories 时，找一个空的 normal 容器
    // 作为新物品类型的专用分类箱。
    // 放在杂项之前：优先为物品建立专有分类，避免散落入杂项。
    if (warehouse.settings.autoCreateCategories) {
      const freeNormal = this.findEmptyNormalContainer(warehouse, model, dimension);
      if (freeNormal) {
        remaining = this.tryContainers(
          remaining,
          [freeNormal],
          warehouse,
          model,
          dimension,
          typeId,
          journal,
          "autocreate"
        );
        if (remaining === undefined) return undefined;
      }
    }

    // ── 优先级 5：杂项（兜底）──────────────────────────────────
    remaining = this.tryContainers(
      remaining,
      model.miscContainerIds,
      warehouse,
      model,
      dimension,
      typeId,
      journal,
      "misc"
    );
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
    journal: MoveJournal,
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
      remaining = tryMoveStackIntoContainerWithJournal(remaining, targetContainer, journal, containerId);

      const placed = beforeAmount - (remaining?.amount ?? 0);
      if (placed > 0) {
        // 家族分拣日志追加容器纯度，方便调试验证纯度排序效果
        let purityLog = "";
        if (tag === "family") {
          const purFamily = getFamily(typeId);
          if (purFamily) {
            const purity = getFamilyPurity(targetContainer!, new Set(purFamily.items));
            purityLog = ` (纯度${(purity * 100).toFixed(0)}%)`;
          }
        }
        log.info(
          `[${tag ?? "?"}]${purityLog} ${typeId} x${placed} → ${containerId} (角色=${stored.role}) @ (${loc.x},${loc.y},${loc.z})`
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
        // 立即重算并持久化该容器的存储统计，复用结果做容量预警
        const stats = refreshContainerStats(warehouse, stored);
        if (stats) {
          this.checkAndWarnCapacity(warehouse, containerId, stored, stats);
        }
      } else if (placed === 0 && beforeAmount > 0 && isContainerFull(targetContainer)) {
        // 物品无法放入（容器已满），尝试发送预警
        this.warnCapacity(
          warehouse,
          containerId,
          stored,
          `§e${stored.role === "normal" ? "普通" : stored.role === "bulk" ? "大宗" : "杂项"}容器已满，物品将转移至其他容器`
        );
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
    journal: MoveJournal
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

      // 在写入前记录目标容器快照
      journal.snapshotTarget(containerId, target);

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
        log.info(`[bulk] ${typeId} x${placed} → ${containerId} @ (${loc.x},${loc.y},${loc.z})`);
        playSortEffect(dimension, stored.occupiedLocations, stored.role);
        this.organizer?.onDeposit(target, containerId, warehouse.settings.autoSortThreshold / 100);
        // 立即重算并持久化该容器的存储统计，复用结果做容量预警
        const bulkStats = refreshContainerStats(warehouse, stored);
        if (bulkStats) {
          this.checkAndWarnCapacity(warehouse, containerId, stored, bulkStats);
        }
      } else if (placed === 0 && beforeAmount > 0 && isContainerFull(target)) {
        this.warnCapacity(
          warehouse,
          containerId,
          stored,
          `§e大宗容器已满，物品将转移至其他容器`
        );
      }

      if (remaining === undefined) return undefined;
    }

    return remaining;
  }

  // ─── 容量预警 ──────────────────────────────────────────────────

  /**
   * 检查容器是否接近满仓，如果是且预警开关已开则发送预警消息。
   *
   * @param stats - refreshContainerStats 返回的已计算统计（避免二次扫描）
   */
  private checkAndWarnCapacity(
    warehouse: WarehouseData,
    containerId: string,
    stored: import("../types").StoredContainer,
    stats: import("../types").ContainerStats
  ): void {
    if (!warehouse.settings.capacityWarning) return;
    if (!stored.capacityWarningEnabled) return;
    if (!stats.isWarning) return;

    const roleLabel = stored.role === "normal" ? "普通" : stored.role === "bulk" ? "大宗" : stored.role === "misc" ? "杂项" : "输入";
    const pct = stats.totalSlots > 0 ? Math.round((stats.usedSlots / stats.totalSlots) * 100) : 0;
    this.warnCapacity(
      warehouse,
      containerId,
      stored,
      `§e${roleLabel}容器 ${containerId.slice(-8)} §7容量告急 §f${stats.usedSlots}§7/§f${stats.totalSlots}§7(§c${pct}%§7)`
    );
  }

  /**
   * 向仓库附近的玩家发送预警消息。
   */
  private warnCapacity(
    warehouse: WarehouseData,
    containerId: string,
    _stored: import("../types").StoredContainer,
    message: string
  ): void {
    // 防刷：每个容器每 5 秒最多发一次预警
    const lastTick = this.warningCooldowns.get(containerId) ?? 0;
    if (system.currentTick - lastTick < CAPACITY_WARNING_COOLDOWN_TICKS) return;
    this.warningCooldowns.set(containerId, system.currentTick);

    try {
      for (const player of world.getPlayers()) {
        if (player.dimension.id !== warehouse.dimensionId) continue;
        if (isNearAreaXZ({ x: player.location.x, z: player.location.z }, warehouse.area, 8)) {
          try {
            player.sendMessage(`§c[容量预警]§r ${message}`);
          } catch { /* 忽略 */ }
        }
      }
    } catch {
      /* world.getPlayers 可能抛出异常 */
    }
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
    const hasIndexEntry = model.itemTypeIndex.has(typeId);

    // ── 阶段 1：校验候选容器 ─────────────────────────────────
    // 有索引时走快速路径（候选集小），无索引时全量扫描所有 normal 容器
    const { valid, stale } = this.validateIndexCandidates(
      hasIndexEntry,
      hasIndexEntry ? model.itemTypeIndex.get(typeId)! : model.normalContainerIds,
      warehouse,
      model,
      typeId,
      dimension
    );

    // ── 阶段 2：惰性清除脏索引 ───────────────────────────────
    if (hasIndexEntry && stale.size > 0) {
      this.cleanStaleIndexEntries(model, typeId, stale);
    }

    // ── 阶段 3：索引全脏后的零延迟回退 ────────────────────────
    // 场景：玩家把圆石从 normal 箱 A 移到 normal 箱 B。
    //       索引指向 A（{"cobblestone":["A"]}），但 A 已无圆石。
    //       阶段 1 会清空索引条目，valid 为空。
    //       此时物品会错误地落入杂项箱。
    // 修复：立即全量扫描，零回合延迟。
    if (hasIndexEntry && stale.size > 0 && valid.length === 0) {
      this.fullScanNormalContainers(warehouse, model, typeId, dimension, valid);
    }

    // ── 阶段 4：学习新发现的容器到索引 ───────────────────────
    // 回退路径下的扫描结果写入索引，下次同类物品走快速路径
    if (!hasIndexEntry && valid.length > 0) {
      model.itemTypeIndex.set(typeId, [...valid]);
    }

    return valid;
  }

  /**
   * 校验候选容器列表中哪些仍然有效，哪些已过时。
   *
   * @param hasIndexEntry - 是否有索引记录（决定脏标记行为）
   * @param candidates    - 候选容器 ID 列表
   * @returns 有效列表和脏数据集合
   */
  private validateIndexCandidates(
    hasIndexEntry: boolean,
    candidates: ContainerId[],
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    typeId: string,
    dimension: Dimension
  ): { valid: ContainerId[]; stale: Set<ContainerId> } {
    const valid: ContainerId[] = [];
    const stale = new Set<ContainerId>();

    for (const containerId of candidates) {
      const stored = warehouse.containers[containerId];
      if (!stored || stored.role !== "normal" || !stored.enabled) {
        if (hasIndexEntry) stale.add(containerId);
        continue;
      }

      const container = getContainerFromStored(dimension, stored);
      if (!container) {
        // 容器不可达（区块未加载）→ 索引路径下保留在索引但本次跳过，
        // 避免因暂时不可达而错误清理索引
        if (hasIndexEntry) valid.push(containerId);
        continue;
      }

      // 空箱短路：容器全空则不可能包含目标物品，无需逐槽扫描
      if (isContainerEmpty(container)) {
        if (hasIndexEntry) stale.add(containerId);
        continue;
      }

      if (containerHasType(container, typeId)) {
        valid.push(containerId);
      } else if (hasIndexEntry) {
        stale.add(containerId);
      }
      // 回退路径（无索引）的候选即使不匹配也不标记脏
      // 因为它们本来就不在索引中
    }

    return { valid, stale };
  }

  /**
   * 从索引中惰性清除脏条目。
   * 如果某类型下所有容器都脏了，删除整个条目。
   */
  private cleanStaleIndexEntries(model: WarehouseRuntimeModel, typeId: string, stale: Set<ContainerId>): void {
    const candidates = model.itemTypeIndex.get(typeId);
    if (!candidates) return;

    const updated = candidates.filter((id) => !stale.has(id));
    if (updated.length > 0) {
      model.itemTypeIndex.set(typeId, updated);
    } else {
      model.itemTypeIndex.delete(typeId);
    }
  }

  /**
   * 全量扫描所有 normal 容器，查找包含指定物品类型的容器。
   * 跳过已在 candidates 中检查过的容器。
   */
  private fullScanNormalContainers(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    typeId: string,
    dimension: Dimension,
    result: ContainerId[]
  ): void {
    for (const containerId of model.normalContainerIds) {
      if (result.includes(containerId)) continue;
      const stored = warehouse.containers[containerId];
      if (!stored || stored.role !== "normal" || !stored.enabled) continue;
      const container = getContainerFromStored(dimension, stored);
      if (!container) continue;
      // 空箱短路：容器全空则不可能包含目标物品
      if (isContainerEmpty(container)) continue;
      if (containerHasType(container, typeId)) {
        result.push(containerId);
      }
    }

    // 将新发现的结果写回索引，下次走快速路径
    if (result.length > 0) {
      model.itemTypeIndex.set(typeId, [...result]);
    }
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

    // 预计算成员 Set，在验证和纯度计算中复用
    const memberSet = new Set(family.items);

    const candidates = model.familyTypeIndex.get(familyId);
    const hasIndex = candidates !== undefined && candidates.length > 0;

    const valid: ContainerId[] = [];
    const stale = new Set<ContainerId>();
    // 缓存已验证通过的容器引用，避免 purity 排序时重复 getContainerFromStored
    const containerCache = new Map<ContainerId, Container>();

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
          containerCache.set(containerId, container);
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
    if (!needsFullScan) {
      return this.sortByFamilyPurity(valid, memberSet, containerCache);
    }

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
          containerCache.set(containerId, container);
          break;
        }
      }
    }

    // 将扫描结果写回索引，下次走快速路径
    if (valid.length > 0) {
      model.familyTypeIndex.set(familyId, [...valid]);
    }

    return this.sortByFamilyPurity(valid, memberSet, containerCache);
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
   * 按家族纯度对候选容器列表降序排序。
   *
   * 纯度越高的容器越优先接收物品，使得家族物品自然流入更"专一"的容器，
   * 避免已混杂多个家族的容器承受过大的物品压力。
   *
   * @param containerIds  - 候选容器 ID 列表
   * @param memberSet     - 目标家族物品 typeId 集合（预计算，O(1) 成员检测）
   * @param containerCache - 验证阶段已获取的容器引用缓存
   * @returns 按纯度降序排序后的容器 ID 列表
   */
  private sortByFamilyPurity(
    containerIds: ContainerId[],
    memberSet: Set<string>,
    containerCache: Map<ContainerId, Container>
  ): ContainerId[] {
    if (containerIds.length <= 1) return containerIds;

    const scored: { id: ContainerId; purity: number; index: number }[] = [];

    let hasPositivePurity = false;
    for (let i = 0; i < containerIds.length; i++) {
      const containerId = containerIds[i];
      // 优先从缓存获取容器（避免索引扫描阶段已获取的容器被重复拉取）
      const container = containerCache.get(containerId);
      if (!container) {
        scored.push({ id: containerId, purity: 0, index: i });
        continue;
      }
      const purity = getFamilyPurity(container, memberSet);
      if (purity > 0) hasPositivePurity = true;
      scored.push({ id: containerId, purity, index: i });
    }

    // 全部候选不可达或纯度均为 0 → 无需排序，保持原始顺序
    if (!hasPositivePurity) return containerIds;

    // 降序排列；同纯度时按原始索引保持稳定（确定性保证）
    scored.sort((a, b) => b.purity - a.purity || a.index - b.index);
    return scored.map((s) => s.id);
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
   * 查找一个空的 normal 容器，用于自动创建新分类。
   *
   * 遍历 normal 容器列表，返回第一个完全空的容器 ID。
   * 如果所有 normal 容器都已有物品，则放弃自动创建（本次走杂项）。
   */
  private findEmptyNormalContainer(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension
  ): ContainerId | undefined {
    for (const containerId of model.normalContainerIds) {
      const stored = warehouse.containers[containerId];
      if (!stored || !stored.enabled) continue;
      const target = getContainerFromStored(dimension, stored);
      if (!target) continue;
      if (isContainerEmpty(target)) return containerId;
    }
    return undefined;
  }

  /**

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
