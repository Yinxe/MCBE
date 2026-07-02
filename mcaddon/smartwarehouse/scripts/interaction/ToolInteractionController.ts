import { world, system, type Player } from "@minecraft/server";
import type { BlockLocation } from "../types";
import { toBlockLocation } from "../types";
import { Logger } from "../util/Logger";
import { isSupportedContainerType } from "../warehouse/ContainerTypes";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseService } from "../warehouse/WarehouseService";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { getSession, setSession, clearSession, clearSessionById } from "./SelectionSessionStore";
import { showMainMenu } from "../ui/MainMenu";
import { showContainerRoleMenu } from "../ui/ContainerRoleMenu";

/**
 * 防抖时间窗口（毫秒）。
 * 用于区分“右键点击方块”和“对空右键”这两个容易连续触发的事件，
 * 避免在点击方块后紧接着的错误 itemUse 事件弹出主菜单。
 */
const DEBOUNCE_MS = 250;

/** 日志记录器，用于输出工具交互模块的运行日志。 */
const logger = new Logger("ToolInteraction");

/**
 * 玩家最近一次右键点击方块的时刻（时间戳），防抖用。
 * 防止 playerInteractWithBlock 之后紧跟的 itemUse 误弹主菜单。
 */
const recentUseOn = new Map<string, number>();

/**
 * 注册所有工具交互事件监听器。
 * 必须在世界初始化时调用一次，之后玩家手持信物即可与仓库系统交互。
 *
 * @param repository  - 仓库数据持久化仓储
 * @param service     - 仓库服务实例，提供仓库查询、创建、修改等核心操作。
 * @param configStore - 模组配置仓储（用于获取信物 ID）
 */
export function registerToolInteraction(repository: WarehouseRepository, service: WarehouseService, configStore: ModConfigStore): void {
  // ── 方块交互事件（玩家手持信物右键点击方块） ──────────────
  // 在事件触发前（beforeEvents）拦截，可以取消默认行为（如打开箱子界面）。
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const player = event.player;
    const itemStack = event.itemStack;
    if (!itemStack || !configStore.isToken(itemStack.typeId)) return;
    if (!event.isFirstEvent) return;
    recentUseOn.set(player.id, Date.now());
    event.cancel = true;
    const blockLocation = toBlockLocation(event.block.location);

    if (isSupportedContainerType(event.block.typeId)) {
      handleContainerClick(player, service, event.block.dimension.id, blockLocation);
    } else {
      handleNonContainerClick(player, service, event.block.dimension.id, blockLocation);
    }
  });

  // ── 物品使用事件（对空右键 / 未触发 playerInteractWithBlock 的兜底） ────
  // 部分容器（如潜影盒）在特定 Bedrock 版本中不触发 playerInteractWithBlock。
  // 此处先通过射线检测判断视线是否对着容器，若是则作为容器点击处理；
  // 否则弹出主菜单。
  world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const itemStack = event.itemStack;
    if (!itemStack || !configStore.isToken(itemStack.typeId)) return;

    // 防抖：避免与 playerInteractWithBlock 重复触发
    const lastUseOn = recentUseOn.get(player.id);
    if (lastUseOn && Date.now() - lastUseOn < DEBOUNCE_MS) return;
    recentUseOn.set(player.id, Date.now());

    // 射线检测 → 容器兜底（潜影盒等可能不触发 playerInteractWithBlock）
    const raycast = player.getBlockFromViewDirection({ maxDistance: 6 });
    if (raycast?.block && isSupportedContainerType(raycast.block.typeId)) {
      const blockLocation = toBlockLocation(raycast.block.location);
      handleContainerClick(player, service, raycast.block.dimension.id, blockLocation);
      return;
    }

    // 视线无容器 → 弹出主菜单
    system.runTimeout(() => {
      showMainMenu(player, repository, service, configStore).catch((error) => {
        logger.error(`MainMenu error for ${player.name}: ${error}`);
      });
    }, 1);
  });

  // ── 玩家离开事件 —— 清理该玩家的所有状态 ─────────────────
  // 避免未完成的选择会话造成内存泄漏或状态混乱。
  world.afterEvents.playerLeave.subscribe((event) => {
    recentUseOn.delete(event.playerId);
    clearSessionById(event.playerId);
  });
}

// ── 内部辅助函数 ──────────────────────────────────────────────────────

/**
 * 处理玩家右键点击受支持容器方块时的逻辑。
 * 查找该容器所属的仓库，定位容器信息，然后显示容器角色设置菜单。
 *
 * @param player       - 执行操作的玩家
 * @param service      - 仓库服务实例
 * @param dimensionId  - 容器所在的维度 ID
 * @param location     - 被点击的方块坐标
 */
function handleContainerClick(
  player: Player,
  service: WarehouseService,
  dimensionId: string,
  location: BlockLocation
): void {
  // 查找该坐标是否属于某个已注册的仓库
  const warehouse = service.findWarehouseAt(dimensionId, location);
  if (!warehouse) {
    // 如果找不到所属仓库，提示玩家该容器尚未被纳入任何仓库
    player.sendMessage("§c该容器不属于任何仓库");
    return;
  }

  // 根据被点击的坐标，在仓库的容器列表中匹配对应的容器条目
  // 匹配依据是容器的 occupiedLocations（占位坐标列表）中是否包含当前点击的坐标
  const containerEntry = Object.entries(warehouse.containers).find(([, c]) =>
    c.occupiedLocations.some((l) => l.x === location.x && l.y === location.y && l.z === location.z)
  );

  if (!containerEntry) {
    // 容器被活塞移动/替换后，记录坐标与实际坐标不一致。
    // 尝试触发一次增量修复：如果该位置确实是个容器，通知玩家 rescan。
    try {
      const block = world.getDimension(dimensionId).getBlock(location);
      if (block && isSupportedContainerType(block.typeId)) {
        player.sendMessage("§e该容器坐标与记录不一致（可能被活塞移动），正在尝试修复...");
        // 增量扫描：先按新位置注册，后续 rescan 完整修复
        service.rescanWarehouse(warehouse.id);
        player.sendMessage("§a已触发仓库重扫，容器数据将在下次扫描后更新");
        return;
      }
    } catch { /* 静默 */ }
    player.sendMessage("§c无法找到容器信息（数据可能已过期，可尝试 /sw:rescan 修复）");
    return;
  }

  const [containerId, container] = containerEntry;

  // 延迟到下一个 tick 打开 UI，因为当前处于 beforeEvents 上下文，
  // 某些 UI 操作在受限执行上下文中可能被禁止。
  system.run(() => {
    showContainerRoleMenu(player, warehouse, containerId, container, service).catch((error) => {
      logger.error(`ContainerRoleMenu error for ${player.name}: ${error}`);
    });
  });
}

/**
 * 处理玩家右键点击非容器方块时的逻辑。
 * 该操作用于仓库创建流程中的区域选择（标记两个对角点）。
 *
 * @param player       - 执行操作的玩家
 * @param service      - 仓库服务实例
 * @param dimensionId  - 所在维度 ID
 * @param location     - 被点击的方块坐标
 */
function handleNonContainerClick(
  player: Player,
  service: WarehouseService,
  dimensionId: string,
  location: BlockLocation
): void {
  // 获取当前玩家的选择会话。如果没有会话，说明尚未进入创建流程。
  const session = getSession(player);

  if (!session) {
    player.sendMessage("§e请先手持信物对空右键打开菜单创建仓库");
    return;
  }

  if (!session.pointA) {
    // 第一次点击 —— 记录第一个对角点（pointA），并提示玩家点击第二个对角点
    setSession(player, { ...session, pointA: location });
    player.sendMessage(`§a已标记第一个点 (${location.x}, ${location.y}, ${location.z})，请标记第二个对角点`);
    return;
  }

  // 第二次点击 —— 两个对角点都已选定，执行仓库创建或其它操作
  const pointA = session.pointA;
  const pointB = location;

  if (session.type === "createWarehouse") {
    // 先捕获 session 数据，之后可以安全清除会话
    const { warehouseName, defaultNewContainerRole, defaultNewContainerEnabled } = session;
    clearSession(player);

    // 延迟到下一 tick 执行创建，确保不在受限执行上下文中
    system.runTimeout(() => {
      try {
        const result = service.createWarehouse(
          warehouseName,
          dimensionId,
          pointA,
          pointB,
          defaultNewContainerRole,
          defaultNewContainerEnabled,
          player.id
        );
        player.sendMessage(
          `§a仓库 "${result.displayName}" 创建成功！共发现 ${Object.keys(result.containers).length} 个容器`
        );
      } catch (error) {
        player.sendMessage(`§c操作失败: ${error}，请重新开始`);
      }
    }, 1);
  } else if (session.type === "resizeWarehouse") {
    const { warehouseId } = session;
    clearSession(player);

    system.runTimeout(() => {
      try {
        const result = service.resizeWarehouse(warehouseId, pointA, pointB);
        player.sendMessage(
          `§a仓库 "${result.displayName}" 调整成功！共发现 ${Object.keys(result.containers).length} 个容器`
        );
      } catch (error) {
        player.sendMessage(`§c操作失败: ${error}，请重新开始`);
      }
    }, 1);
  } else {
    clearSession(player);
    return;
  }
}
