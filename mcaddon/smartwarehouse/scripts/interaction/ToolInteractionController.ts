import { world, system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import type { BlockLocation } from "../types";
import { toBlockLocation } from "../types";
import { Logger } from "../util/Logger";
import { makeOccupiedLocationKey } from "../warehouse/ContainerId";
import { isSupportedContainerType } from "../warehouse/ContainerTypes";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { getSession, setSession, clearSession, clearSessionById } from "./SelectionSessionStore";
import { showMainMenu } from "../ui/MainMenu";
import { showContainerRoleMenu } from "../ui/ContainerRoleMenu";

/**
 * 用于触发交互的工具物品 ID —— 木锄。
 * 玩家手持木锄右键点击方块或对空右键，即可唤起仓库管理菜单。
 */
const TOOL_ID = "minecraft:wooden_hoe";

/**
 * 防抖时间窗口（毫秒）。
 * 用于区分“右键点击方块”和“对空右键”这两个容易连续触发的事件，
 * 避免在点击方块后紧接着的错误 itemUse 事件弹出主菜单。
 */
const DEBOUNCE_MS = 250;

/** 日志记录器，用于输出工具交互模块的运行日志。 */
const logger = new Logger("ToolInteraction");

/**
 * 每位玩家最近一次右键点击方块的时刻（时间戳），用于防抖判断。
 * key: player.id, value: Date.now()
 * 目的是防止 playerInteractWithBlock 之后紧跟着的 itemUse（对空右键）误触发主菜单。
 */
const recentUseOn = new Map<string, number>();

/**
 * 注册所有工具交互事件监听器。
 * 必须在世界初始化时调用一次，之后玩家手持木锄即可与仓库系统交互。
 *
 * @param repository - 仓库数据持久化仓储
 * @param service - 仓库服务实例，提供仓库查询、创建、修改等核心操作。
 */
export function registerToolInteraction(repository: WarehouseRepository, service: WarehouseService): void {
  // ── 方块交互事件（玩家手持木锄右键点击方块） ──────────────
  // 在事件触发前（beforeEvents）拦截，可以取消默认行为（如打开箱子界面）。
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const player = event.player;
    const itemStack = event.itemStack;

    // 仅处理手持木锄的交互，其它工具忽略
    if (!itemStack || itemStack.typeId !== TOOL_ID) return;

    // 只处理第一次按下，忽略按住时重复触发的后续事件
    if (!event.isFirstEvent) return;

    // 记录此次交互时间戳，用于屏蔽后续 itemUse 事件的误触发
    recentUseOn.set(player.id, Date.now());

    // 取消默认的方块交互行为（例如阻止打开容器界面），由我们接管
    event.cancel = true;

    // 将事件的坐标转换为游戏内统一的方块坐标格式
    const blockLocation = toBlockLocation(event.block.location);

    // 根据点击的方块类型分发处理：
    // - 如果是受支持的容器方块 → 显示容器角色菜单
    // - 否则 → 作为选择区域的选点操作
    if (isSupportedContainerType(event.block.typeId)) {
      handleContainerClick(player, service, event.block.dimension.id, blockLocation);
    } else {
      handleNonContainerClick(player, service, event.block.dimension.id, blockLocation);
    }
  });

  // ── 物品使用事件（玩家手持木锄对空右键，未点击任何方块） ────
  // 使用 afterEvents 是因为需要在正常交互完成后触发。
  world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const itemStack = event.itemStack;

    // 仅处理木锄
    if (!itemStack || itemStack.typeId !== TOOL_ID) return;

    // 防抖检查：如果玩家刚刚右键点击过方块（在 DEBOUNCE_MS 毫秒内），
    // 则跳过此次事件，避免重复弹出主菜单。
    const lastUseOn = recentUseOn.get(player.id);
    if (lastUseOn && Date.now() - lastUseOn < DEBOUNCE_MS) {
      return;
    }

    // 延迟到下一个 tick 执行，以规避某些执行上下文（如 restricted execution context）的限制。
    system.run(() => {
      showMainMenu(player, repository, service).catch((error) => {
        logger.error(`MainMenu error for ${player.name}: ${error}`);
      });
    });
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
    // 理论上不应发生，但做防御性处理
    player.sendMessage("§c无法找到容器信息");
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
    player.sendMessage("§e请先使用木锄对空右键打开菜单创建仓库");
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

  try {
    if (session.type === "createWarehouse") {
      // 调用服务层创建仓库，传入仓库名称、维度、两个对角点以及默认容器角色
      const result = service.createWarehouse(
        session.warehouseName,
        dimensionId,
        pointA,
        pointB,
        session.defaultNewContainerRole,
        session.defaultNewContainerEnabled
      );
      player.sendMessage(
        `§a仓库 "${result.displayName}" 创建成功！共发现 ${Object.keys(result.containers).length} 个容器`
      );
    } else {
      // 预留的 resizeWarehouse（调整仓库范围）功能，当前 MVP 版本尚未实现
      player.sendMessage("§c调整仓库功能待后续实现");
      return;
    }
  } catch (error) {
    // 操作失败时清除会话，让玩家可以重新开始
    clearSession(player);
    player.sendMessage(`§c操作失败: ${error}，请重新开始`);
    return;
  }

  // 操作成功完成后清理会话状态
  clearSession(player);
}
