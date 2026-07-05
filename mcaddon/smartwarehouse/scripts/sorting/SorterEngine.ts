import { Dimension, Container, ItemStack } from "@minecraft/server";
import type { WarehouseData, WarehouseId, WarehouseRuntimeModel, ContainerId } from "../types";
import { WarehouseRepository } from "../storage/WarehouseRepository";
import { WarehouseRuntimeRegistry } from "../runtime/WarehouseRuntimeRegistry";
import { Logger } from "../util/Logger";
import { SortHooks } from "../util/SortHooks";
import { getContainerFromStored, isContainerEmpty, getBulkChestFirstType, getFamilyPurity } from "./ContainerInventory";
import { MoveJournal } from "./MoveJournal";
import { playSortEffect } from "./SortEffects";
import { SlotOrganizer } from "../organize/SlotOrganizer";
import { getFamily } from "../data/ItemFamilies";
import { refreshContainerStats } from "../ui/WarehouseStats";
import { checkWarehouseAreaLoaded, getDimensionSafe } from "../warehouse/AreaCheck";
import { CapacityWarningService } from "./CapacityWarningService";
import {
  findExistingTypeContainers,
  findExistingFamilyContainers,
  fullScanNormalContainers,
  addToTypeIndex,
  addToFamilyIndex,
} from "./SortingIndexManager";

const log = new Logger("SorterEngine");
/**
 * 分拣引擎 —— 将物品从输入容器分拣到对应的存储容器（普通 / 杂项）中。
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
  private readonly capacityWarning = new CapacityWarningService();

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
    checkWarehouseAreaLoaded(warehouse, model);
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

  /**
   * 获取或构建仓库的运行时模型（用于调度器预检输入容器是否存在）。
   * 首次调用时会从持久化存储加载，后续使用缓存。
   */
  getRuntimeModel(warehouseId: WarehouseId): WarehouseRuntimeModel | undefined {
    return this.runtime.getOrBuild(warehouseId);
  }

  // ─── 输入容器处理 ───────────────────────────────────────────────

  /**
   * 处理单个输入容器的分拣。
   *
   * 遍历容器中所有槽位，逐个尝试分拣。无法分类的物品**留在原地**，
   * 不会阻塞后续槽位的处理，且下个 tick 会再次尝试。
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

      const dimension = getDimensionSafe(stored.dimensionId);
      if (!dimension) return;

      const container = getContainerFromStored(dimension, stored);
      if (!container) return;

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
      const typeId = stack.typeId;
      log.info(`槽 ${slot}：${typeId} x${originalAmount}`);

      // 记录源槽位快照（用于回滚），然后直接通过 transferItem 分拣
      journal.snapshotSource(containerId, container, slot);
      this.sortFromContainer(container, slot, typeId, warehouse, model, dimension, journal);

      // sortFromContainer 返回后，源槽位即"剩余量"
      const afterStack = container.getItem(slot);
      if (!afterStack) {
        log.info(`槽 ${slot} 已清空（全部 ${originalAmount} 个已放置）`);
      } else if (afterStack.amount < originalAmount) {
        log.info(`槽 ${slot} 部分放置：${afterStack.amount}/${originalAmount} 返回`);
      } else {
        log.info(`槽 ${slot} 无法分类（${originalAmount} 个未变动）`);
      }

      // 无论结果如何，游标 +1（回绕），不阻塞
      model.inputSlotCursors.set(containerId, (slot + 1) % container.size);
    } catch (error) {
      log.error(`处理输入容器 ${containerId} 时出错: ${error}`);
      this.rollbackJournal(journal, warehouse);
    }
  }

  /**
   * 统一回滚分拣事务并处理结果。
   *
   * 在 processInputContainer 的三个不同失败路径中被调用：
   * 1. 清空输入槽失败（全部放入后）
   * 2. 余量回写失败（部分放入后）
   * 3. try-catch 外层异常捕获
   *
   * 回滚成功 → 标记运行时脏，下次访问自动重建索引。
   * 回滚失败 → 停用仓库（防止继续分拣导致数据不一致），保留现场供管理员排查。
   */
  private rollbackJournal(journal: MoveJournal, warehouse: WarehouseData): void {
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

  // ─── 目标选择与转移 ─────────────────────────────────────────────

  /**
   * 从源容器槽位直接向存储容器转移物品（使用 transferItem）。
   *
   * 与 moveStackIntoWarehouse 的区别：
   * - 使用 Container.transferItem() 直接移动方块间物品，避免 getItem 副本开销
   * - 源槽位状态即"剩余量"，无需额外变量追踪
   */
  private sortFromContainer(
    source: Container,
    sourceSlot: number,
    typeId: string,
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension,
    journal: MoveJournal
  ): void {
    const sourceAmount = source.getItem(sourceSlot)?.amount ?? 0;

    // ── 优先级 1~5：统一使用 transferItem ────────────────
    const bulkMatches = this.findMatchingBulk(typeId, warehouse, model, dimension);
    if (this.tryTransfer(source, sourceSlot, bulkMatches, warehouse, model, dimension, typeId, journal, "bulk")) return;

    const indexedTypeContainers = findExistingTypeContainers(warehouse, model, typeId, dimension);
    if (
      this.tryTransfer(source, sourceSlot, indexedTypeContainers, warehouse, model, dimension, typeId, journal, "match")
    )
      return;

    if (
      this.tryTransferUnindexed(source, sourceSlot, typeId, indexedTypeContainers, warehouse, model, dimension, journal)
    )
      return;

    const family = getFamily(typeId);
    if (family && (warehouse.settings.enabledFamilies ?? []).includes(family.id)) {
      if (
        this.tryTransfer(
          source,
          sourceSlot,
          findExistingFamilyContainers(warehouse, model, family.id, dimension),
          warehouse,
          model,
          dimension,
          typeId,
          journal,
          "family"
        )
      )
        return;
    }

    if (warehouse.settings.autoCreateCategories) {
      const freeNormal = this.findEmptyNormalContainer(warehouse, model, dimension);
      if (freeNormal)
        this.tryTransfer(source, sourceSlot, [freeNormal], warehouse, model, dimension, typeId, journal, "autocreate");
    }

    this.tryTransfer(source, sourceSlot, model.miscContainerIds, warehouse, model, dimension, typeId, journal, "misc");

    // ── 降级/全满预警 ────────────────────────────────────
    // 代码走到此处说明至少有一个优先级没处理完余量
    const afterAmount = source.getItem(sourceSlot)?.amount ?? 0;
    const placed = sourceAmount - afterAmount;
    if (placed > 0) {
      // 有物品被放置但仍有剩余 → 候选容器全满，降级发生
      this.capacityWarning.warnDowngrade(warehouse, "normal", "misc");
    } else if (afterAmount >= sourceAmount) {
      // 所有优先级都没有放进去任何物品 → 全仓满
      this.capacityWarning.warnWarehouseFull(warehouse);
    }
  }

  /**
   * 尝试将源容器槽位中的物品 transferItem 到候选容器列表。
   * 每次 transferItem 成功后将候选容器加入索引并播放效果。
   *
   * @returns true = 源槽位已清空（全部放完）
   */
  private tryTransfer(
    source: Container,
    sourceSlot: number,
    containerIds: ContainerId[],
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension,
    typeId: string,
    journal: MoveJournal,
    tag: string
  ): boolean {
    for (const containerId of containerIds) {
      const beforeAmount = source.getItem(sourceSlot)?.amount ?? 0;
      if (beforeAmount === 0) return true;

      const stored = warehouse.containers[containerId];
      if (!stored) continue;
      const target = getContainerFromStored(dimension, stored);
      if (!target) continue;

      journal.snapshotTarget(containerId, target);
      source.transferItem(sourceSlot, target);

      const afterAmount = source.getItem(sourceSlot)?.amount ?? 0;
      const placed = beforeAmount - afterAmount;

      if (placed > 0) {
        let purityLog = "";
        if (tag === "family") {
          const purFamily = getFamily(typeId);
          if (purFamily) {
            const purity = getFamilyPurity(target, new Set(purFamily.items));
            purityLog = ` (纯度${(purity * 100).toFixed(0)}%)`;
          }
        }
        log.info(
          `[${tag}]${purityLog} ${typeId} x${placed} → ${containerId} @ (${stored.primaryLocation.x},${stored.primaryLocation.y},${stored.primaryLocation.z})`
        );
        addToTypeIndex(model, typeId, containerId);
        const placedFamily = getFamily(typeId);
        if (placedFamily && (warehouse.settings.enabledFamilies ?? []).includes(placedFamily.id)) {
          addToFamilyIndex(model, placedFamily.id, containerId);
        }
        playSortEffect(dimension, stored.occupiedLocations, stored.role);
        this.organizer?.onDeposit(target, containerId, warehouse.settings.autoSortThreshold / 100);
        const stats = refreshContainerStats(warehouse, stored);
        if (stats) this.capacityWarning.checkContainer(warehouse, containerId, stored, stats);

        SortHooks.run({
          stack: source.getItem(sourceSlot) ?? new ItemStack(typeId, placed),
          placed,
          remaining: afterAmount > 0 ? (source.getItem(sourceSlot) ?? undefined) : undefined,
          targetContainerId: containerId,
          targetContainer: target,
          warehouse,
          tag,
        });
        if (afterAmount === 0) return true;
      }
    }
    return false;
  }

  /**
   * 索引容器全满时兜底全量扫描，通过 transferItem 尝试放入未索引容器。
   */
  private tryTransferUnindexed(
    source: Container,
    sourceSlot: number,
    typeId: string,
    indexedContainerIds: ContainerId[],
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension,
    journal: MoveJournal
  ): boolean {
    if (!model.itemTypeIndex.has(typeId)) return false;
    const freshValid: ContainerId[] = [];
    fullScanNormalContainers(warehouse, model, typeId, dimension, freshValid);
    const unindexed = freshValid.filter((id) => !indexedContainerIds.includes(id));
    if (unindexed.length === 0) return false;
    return this.tryTransfer(source, sourceSlot, unindexed, warehouse, model, dimension, typeId, journal, "match");
  }

  /**
   * 查找匹配当前物品类型的大宗容器。
   * 全量扫描 bulkContainerIds（数量极少 ~1-5，走索引无收益）。
   */
  private findMatchingBulk(
    typeId: string,
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension
  ): ContainerId[] {
    return model.bulkContainerIds.filter((id) => {
      const stored = warehouse.containers[id];
      if (!stored) return false;
      const target = getContainerFromStored(dimension, stored);
      if (!target) return false;
      if (isContainerEmpty(target)) return false;
      return getBulkChestFirstType(target) === typeId;
    });
  }

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
}
