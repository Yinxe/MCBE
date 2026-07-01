import { world } from "@minecraft/server";
import type {
  BlockLocation,
  ContainerId,
  ContainerRole,
  StoredContainer,
  WarehouseArea,
  WarehouseData,
  WarehouseId,
  WarehouseSettings,
} from "../types";
import { toBlockLocation, ROLE_LABELS } from "../types";
import { DEFAULT_WAREHOUSE_SETTINGS, normalizeWarehouseId, WarehouseRepository } from "../storage/WarehouseRepository";
import { areaVolume, areasTooClose, isInsideArea, normalizeArea } from "../util/Vector";
import { ContainerScanner } from "./ContainerScanner";
import { hasInventory, isSupportedContainerType } from "./ContainerTypes";
import { makeContainerId } from "./ContainerId";
import { compareLocationForPrimary } from "../util/Vector";
import { BoundaryDisplay } from "./BoundaryDisplay";

/**
 * 单次扫描操作允许的最大方块体积上限。
 *
 * 65536 = 64×64×16（即一块 64×64 基底、16 格高的柱状区域）。
 * 该限制确保同步全区域扫描在已加载区块范围内的单个 tick 内完成。
 * 超出此体积可能导致服务端卡顿或被看门狗（watchdog）终止。
 */
const MAX_SCAN_VOLUME = 65_536;

/**
 * 单个仓库允许容纳的最大容器数量上限。
 * 超过此数量的容器会被拒绝注册，防止数据膨胀。
 */
const MAX_CONTAINERS = 512;

/**
 * 仓库之间的最小间距（方块数）。
 * 两个仓库区域在各轴向上都必须至少相距此距离，防止重叠和容器归属混乱。
 */
const MIN_WAREHOUSE_SPACING = 4;

/**
 * 仓库服务（WarehouseService）
 *
 * 智能仓库系统的核心业务逻辑层。负责：
 * - 仓库的创建、调整大小、重新扫描和删除
 * - 容器角色的设置
 * - 玩家放置/破坏方块事件的自动维护（重新扫描受影响仓库）
 *
 * 所有持久化操作委托给 `WarehouseRepository`，
 * 区域扫描委托给 `ContainerScanner`。
 * 脏标记回调（markRuntimeDirty）用于通知运行时缓存失效。
 */
export class WarehouseService {
  /**
   * @param repository          仓库数据的持久化存储仓库
   * @param scanner             容器扫描器（可注入，便于测试）
   * @param markRuntimeDirty    脏标记回调函数，仓库数据变更时调用以通知运行时缓存失效
   * @param notifyScheduler     调度刷新回调，仓库启用/禁用/速度变化/删除时通知调度器刷新 interval
   * @param boundaryDisplay     边界显示调度器（可选）
   */
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly scanner = new ContainerScanner(),
    private readonly markRuntimeDirty: (warehouseId: WarehouseId) => void = () => undefined,
    private readonly notifyScheduler?: (warehouseId: WarehouseId) => void,
    private readonly boundaryDisplay?: BoundaryDisplay
  ) {}

  /**
   * 创建一个新的仓库。
   *
   * 流程：
   * 1. 根据名称生成标准化的仓库 ID，检查是否已存在
   * 2. 规范化区域坐标（确保 min ≤ max）
   * 3. 校验扫描体积是否在允许范围内
   * 4. 在指定维度中扫描区域内的所有容器
   * 5. 校验容器数量是否超过上限
   * 6. 写入持久化存储并标记脏
   *
   * @param name            仓库显示名称
   * @param dimensionId     仓库所在维度 ID
   * @param pointA          区域角点 A
   * @param pointB          区域角点 B
   * @param defaultRole     新容器的默认角色
   * @param defaultEnabled  新容器默认是否启用
   * @returns 创建的仓库数据对象
   * @throws 如果仓库 ID 已存在、区域过大或容器过多
   */
  createWarehouse(
    name: string,
    dimensionId: string,
    pointA: BlockLocation,
    pointB: BlockLocation,
    defaultRole: ContainerRole,
    defaultEnabled: boolean = true,
    ownerId: string = ""
  ): WarehouseData {
    const id = normalizeWarehouseId(name);
    if (this.repository.exists(id)) throw new Error(`仓库 ${id} 已存在`);
    const area = normalizeArea(pointA, pointB);
    this.assertScanVolume(area);
    // 检查新仓库与所有已有仓库是否间距不足
    this.assertWarehouseSpacing(area, dimensionId, undefined);
    const dimension = world.getDimension(dimensionId);
    const containers = this.scanner.scan(dimension, area, defaultRole, defaultEnabled);
    this.assertContainerCount(containers);

    const data: WarehouseData = {
      version: 1,
      id,
      displayName: name.trim(),
      dimensionId,
      area,
      ownerId,
      settings: { ...DEFAULT_WAREHOUSE_SETTINGS, defaultNewContainerRole: defaultRole, defaultNewContainerEnabled: defaultEnabled },
      containerShardCount: 0,
      containerCount: Object.keys(containers).length,
      containerShardGeneration: 0,
      containers,
    };
    this.repository.create(data);
    this.markRuntimeDirty(data.id);
    this.notifyScheduler?.(data.id);
    return data;
  }

  /**
   * 重新扫描指定仓库的区域，更新容器列表。
   *
   * 保留已有容器的角色（role）和发现时间（discoveredAt），
   * 新发现的容器使用仓库设置的默认角色。
   * 这通常用于手动刷新或响应方块变化后的自动更新。
   *
   * @param id 仓库 ID
   * @returns 更新后的仓库数据对象
   * @throws 如果仓库不存在
   */
  rescanWarehouse(id: WarehouseId): WarehouseData {
    const warehouse = this.requireWarehouse(id);
    const dimension = world.getDimension(warehouse.dimensionId);
    const containers = this.scanner.scan(
      dimension,
      warehouse.area,
      warehouse.settings.defaultNewContainerRole,
      warehouse.settings.defaultNewContainerEnabled,
      warehouse.containers
    );
    this.assertContainerCount(containers);
    const updated = { ...warehouse, containers };
    this.repository.save(updated);
    this.markRuntimeDirty(id);
    return updated;
  }

  /**
   * 调整现有仓库的区域范围。
   *
   * 流程：
   * 1. 重新规范化区域坐标
   * 2. 校验新区域的扫描体积
   * 3. 在新区域中扫描所有容器
   * 4. 过滤掉不在新区域内的容器（区域缩小时会移除边缘容器）
   * 5. 校验容器数量
   * 6. 保存并标记脏
   *
   * @param id      仓库 ID
   * @param pointA  新区域角点 A
   * @param pointB  新区域角点 B
   * @returns 更新后的仓库数据对象
   * @throws 如果仓库不存在、新区域过大或容器过多
   */
  resizeWarehouse(id: WarehouseId, pointA: BlockLocation, pointB: BlockLocation): WarehouseData {
    const warehouse = this.requireWarehouse(id);
    const area = normalizeArea(pointA, pointB);
    this.assertScanVolume(area);
    this.assertWarehouseSpacing(area, warehouse.dimensionId, id);
    const dimension = world.getDimension(warehouse.dimensionId);
    const scanned = this.scanner.scan(
      dimension,
      area,
      warehouse.settings.defaultNewContainerRole,
      warehouse.settings.defaultNewContainerEnabled,
      warehouse.containers
    );
    // 只保留主位置在新区域内的容器（区域缩小时丢弃外部容器）
    const containers = Object.fromEntries(
      Object.entries(scanned).filter(([, container]) => isInsideArea(container.primaryLocation, area))
    );
    this.assertContainerCount(containers);
    const updated = { ...warehouse, area, containers };
    this.repository.save(updated);
    this.markRuntimeDirty(id);
    this.notifyScheduler?.(id);
    return updated;
  }

  /**
   * 删除指定仓库。
   *
   * 从持久化存储中移除仓库的所有数据，
   * 并通知运行时清除对应的缓存。
   *
   * @param id 要删除的仓库 ID
   */
  deleteWarehouse(id: WarehouseId): void {
    this.repository.delete(id);
    this.markRuntimeDirty(id);
    this.notifyScheduler?.(id);
    this.boundaryDisplay?.stop(id);
  }

  /**
   * 设置仓库中某个容器的角色。
   *
   * 更新指定容器的角色（role）和更新时间戳（updatedAt），
   * 其他属性保持不变。此操作会触发仓库数据的持久化和脏标记。
   *
   * @param id          仓库 ID
   * @param containerId 容器 ID（字符串标识符）
   * @param role        要设置的新角色
   * @returns 更新后的仓库数据对象
   * @throws 如果仓库不存在或容器不属于该仓库
   */
  /**
   * 设置容器角色和启用状态。
   *
   * @param id          仓库 ID
   * @param containerId 容器 ID
   * @param role        新角色（null 表示不修改角色）
   * @param enabled     是否启用（null 表示不修改启用状态）
   * @returns 更新后的仓库数据
   */
  setContainerRoleAndState(
    id: WarehouseId,
    containerId: string,
    role: ContainerRole | null,
    enabled: boolean | null
  ): WarehouseData {
    const warehouse = this.requireWarehouse(id);
    const container = warehouse.containers[containerId];
    if (!container) throw new Error(`容器 ${containerId} 不属于仓库 ${id}`);
    const updated: WarehouseData = {
      ...warehouse,
      containers: {
        ...warehouse.containers,
        [containerId]: {
          ...container,
          ...(role !== null && { role }),
          ...(enabled !== null && { enabled }),
          updatedAt: Date.now(),
        },
      },
    };
    this.repository.save(updated);
    this.markRuntimeDirty(id);
    return updated;
  }

  /**
   * 更新仓库设置。
   *
   * @param id       仓库 ID
   * @param settings 新的设置（部分更新，只传要改的字段）
   * @returns 更新后的仓库数据
   */
  updateSettings(id: WarehouseId, settings: Partial<WarehouseSettings>): WarehouseData {
    const warehouse = this.requireWarehouse(id);
    const updated: WarehouseData = {
      ...warehouse,
      settings: { ...warehouse.settings, ...settings },
    };
    this.repository.save(updated);
    this.markRuntimeDirty(id);
    this.notifyScheduler?.(id);

    // 边界显示变化：启停 BoundaryDisplay
    if (this.boundaryDisplay && "showBoundary" in settings) {
      if (updated.settings.showBoundary) {
        this.boundaryDisplay.start(id, updated.area, updated.dimensionId);
      } else {
        this.boundaryDisplay.stop(id);
      }
    }

    return updated;
  }

  /**
   * 重命名仓库。
   *
   * @param id      仓库 ID
   * @param newName 新的显示名称
   * @returns 更新后的仓库数据
   */
  renameWarehouse(id: WarehouseId, newName: string): WarehouseData {
    const warehouse = this.requireWarehouse(id);
    const updated: WarehouseData = {
      ...warehouse,
      displayName: newName.trim(),
    };
    this.repository.save(updated);
    this.markRuntimeDirty(id);
    return updated;
  }

  /**
   * 查找包含指定坐标位置的仓库。
   *
   * 遍历所有已加载的仓库，检查目标坐标是否落在某个仓库的区域内
   * 且维度匹配。用于玩家放置/破坏方块时定位受影响的仓库。
   *
   * @param dimensionId 维度 ID
   * @param location    要检查的世界坐标
   * @returns 找到的仓库数据对象，如果没有匹配则返回 undefined
   */
  findWarehouseAt(dimensionId: string, location: BlockLocation): WarehouseData | undefined {
    return this.repository
      .loadAll()
      .find((warehouse) => warehouse.dimensionId === dimensionId && isInsideArea(location, warehouse.area));
  }

  /**
   * 根据 ID 获取仓库数据，如果不存在则抛出异常。
   *
   * @param id 仓库 ID
   * @returns 仓库数据对象
   * @throws 如果仓库不存在
   */
  requireWarehouse(id: WarehouseId): WarehouseData {
    const warehouse = this.repository.load(id);
    if (!warehouse) throw new Error(`仓库 ${id} 不存在`);
    return warehouse;
  }

  /**
   * 校验仓库区域的扫描体积是否超过上限。
   *
   * @param area 仓库区域
   * @throws 如果区域体积超过 MAX_SCAN_VOLUME
   */
  private assertScanVolume(area: WarehouseArea): void {
    const volume = areaVolume(area);
    if (volume > MAX_SCAN_VOLUME) throw new Error(`仓库区域过大：${volume} > ${MAX_SCAN_VOLUME}`);
  }

  /**
   * 校验容器数量是否超过单个仓库的上限。
   *
   * @param containers 容器记录
   * @throws 如果容器数量超过 MAX_CONTAINERS
   */
  private assertContainerCount(containers: Record<ContainerId, StoredContainer>): void {
    const count = Object.keys(containers).length;
    if (count > MAX_CONTAINERS) throw new Error(`仓库容器过多：${count} > ${MAX_CONTAINERS}`);
  }

  /**
   * 校验新仓库区域与所有已有仓库之间的间距是否满足最小距离要求。
   * 同一维度下，两个仓库在三个轴向上必须至少相隔 MIN_WAREHOUSE_SPACING 格，
   * 防止重叠和容器归属混乱。
   *
   * @param area        新仓库的区域
   * @param dimensionId 新仓库所在的维度
   * @param excludeId   排除的仓库 ID（调整大小时排除自身）
   * @throws 如果间距不足
   */
  private assertWarehouseSpacing(area: WarehouseArea, dimensionId: string, excludeId: WarehouseId | undefined): void {
    const existing = this.repository.loadAll();
    for (const other of existing) {
      if (other.id === excludeId) continue;
      if (other.dimensionId !== dimensionId) continue;
      if (areasTooClose(area, other.area, MIN_WAREHOUSE_SPACING)) {
        throw new Error(
          `仓库 "${other.displayName}" 距离过近（最小间距 ${MIN_WAREHOUSE_SPACING} 格），请选择其他区域`
        );
      }
    }
  }

  /**
   * 注册方块放置和破坏事件的自动维护监听器。
   *
   * **范围缩小**：仅在放置/破坏受支持的容器方块（箱子、桶、潜影盒）时触发。
   *
   * **增量更新**：不进行全区域扫描，而是直接添加或移除单个容器记录，
   * 大幅降低性能开销。
   *
   * 事件处理器内部的错误会被捕获并通过 console.warn 记录，
   * 这样单个事件处理失败不会影响整个脚本的运行。
   */
  registerBlockMaintenance(): void {
    // 方块放置：仅当放置的是受支持的容器时，增量添加
    world.afterEvents.playerPlaceBlock.subscribe((event) => {
      try {
        const location = toBlockLocation(event.block.location);
        if (!isSupportedContainerType(event.block.typeId)) return;
        const warehouse = this.findWarehouseAt(event.dimension.id, location);
        if (warehouse) {
          this.addContainerToWarehouse(warehouse.id, event.block, location, event.player);
        }
      } catch (e) {
        console.warn("[SmartWarehouse] playerPlaceBlock 处理器错误:", e);
      }
    });

    // 方块破坏：仅当破坏的是受支持的容器时，增量删除
    world.afterEvents.playerBreakBlock.subscribe((event) => {
      try {
        const location = toBlockLocation(event.block.location);
        const warehouse = this.findWarehouseAt(event.dimension.id, location);
        if (warehouse) {
          this.removeContainerFromWarehouse(warehouse.id, event.dimension.id, location, event.player);
        }
      } catch (e) {
        console.warn("[SmartWarehouse] playerBreakBlock 处理器错误:", e);
      }
    });
  }

  /**
   * 增量添加容器到仓库（放置事件）。
   *
   * 扫描新方块的实际占用位置（处理双箱），创建 StoredContainer 后，
   * 合并到仓库数据中并持久化，并通过 `trySendMessage` 向玩家反馈。
   */
  private addContainerToWarehouse(
    warehouseId: WarehouseId,
    block: import("@minecraft/server").Block,
    location: BlockLocation,
    player: import("@minecraft/server").Player
  ): void {
    const warehouse = this.requireWarehouse(warehouseId);
    const occupiedLocations = this.scanner.getOccupiedLocations(
      world.getDimension(warehouse.dimensionId),
      location,
      block
    );
    const primary = [...occupiedLocations].sort(compareLocationForPrimary)[0];
    const id = makeContainerId(warehouse.dimensionId, primary);
    const now = Date.now();

    const container: StoredContainer = {
      id,
      dimensionId: warehouse.dimensionId,
      primaryLocation: primary,
      occupiedLocations: occupiedLocations.sort(compareLocationForPrimary),
      role: warehouse.settings.defaultNewContainerRole,
      enabled: warehouse.settings.defaultNewContainerEnabled,
      discoveredAt: now,
      updatedAt: now,
    };

    const updated: WarehouseData = {
      ...warehouse,
      containers: { ...warehouse.containers, [id]: container },
    };
    this.repository.save(updated);
    this.markRuntimeDirty(warehouseId);

    try {
      player.sendMessage(
        `§a容器已添加至仓库 "${warehouse.displayName}"（${block.typeId.replace("minecraft:", "")}，角色：${ROLE_LABELS[warehouse.settings.defaultNewContainerRole]}）`
      );
    } catch { /* 玩家可能已断线，忽略 */ }
  }

  /**
   * 增量从仓库移除容器（破坏事件）。
   *
   * 根据被破坏方块的坐标，从仓库容器列表中查找并移除对应记录，
   * 然后持久化，并通过 `trySendMessage` 向玩家反馈。
   */
  private removeContainerFromWarehouse(
    warehouseId: WarehouseId,
    dimensionId: string,
    location: BlockLocation,
    player: import("@minecraft/server").Player
  ): void {
    const warehouse = this.requireWarehouse(warehouseId);

    // 查找被破坏位置属于哪个容器
    const targetEntry = Object.entries(warehouse.containers).find(([, c]) =>
      c.occupiedLocations.some((l) => l.x === location.x && l.y === location.y && l.z === location.z)
    );
    if (!targetEntry) return;

    const [containerId] = targetEntry;
    const { [containerId]: _removed, ...rest } = warehouse.containers;

    const updated: WarehouseData = {
      ...warehouse,
      containers: rest,
    };
    this.repository.save(updated);
    this.markRuntimeDirty(warehouseId);

    try {
      player.sendMessage(`§e容器已从仓库 "${warehouse.displayName}" 移除（${containerId}）`);
    } catch { /* 玩家可能已断线，忽略 */ }
  }
}
