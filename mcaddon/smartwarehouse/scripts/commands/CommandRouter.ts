/**
 * ============================================================================
 * CommandRouter —— SmartWarehouse 自定义命令路由层
 * ============================================================================
 *
 * 职责概述：
 * 1. 在服务器启动阶段注册所有自定义命令（sw:create / sw:resize / sw:rescan / sw:delete）
 * 2. 验证命令执行者的身份（必须是玩家）与权限（必须拥有 op 标签）
 * 3. 解析命令参数（仓库名称、坐标等），进行基础校验后委托给 WarehouseService
 * 4. 统一通过 system.runTimeout() 进行异步执行，并通过 trySendMessage() 安全地向玩家反馈结果
 *
 * 权限机制：
 * - 所有命令在注册时 permissionLevel 设为 Admin，且 cheatsRequired 为 true
 * - 运行时通过 canManageWarehouse() 二次校验玩家是否具有 op 标签
 * - 校验失败时返回用户友好的中文错误提示
 *
 * 参数类型：
 * - 区域型命令（create / resize）：string 名称 + 6 个 int 坐标参数
 * - 名称型命令（rescan / delete）：仅 string 名称参数
 * ============================================================================
 */

import {
  world,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  type CustomCommand,
  type CustomCommandOrigin,
  type CustomCommandResult,
} from "@minecraft/server";
import type { Vector3, EntityInventoryComponent } from "@minecraft/server";
import type { ContainerId, WarehouseId } from "../types";
import { ROLE_LABELS, ROLE_ORDER, WAREHOUSE_NEARBY_MARGIN } from "../types";
import { SlotOrganizer } from "../organize/SlotOrganizer";
import { formatOrganizeResult } from "../organize/OrganizeFormatter";
import { normalizeWarehouseId } from "../storage/WarehouseRepository";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { canManageWarehouse } from "../util/PlayerAuth";
import { Logger } from "../util/Logger";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { showMainMenu } from "../ui/MainMenu";
import { SearchService, formatSearchResult } from "../warehouse/SearchService";
import { startMarkerParticles } from "../ui/SearchUI";
import { filterNearbyOwnedWarehouses } from "../util/Vector";

/** CommandRouter 专用的日志记录器实例，用于输出调试和运行信息 */
const log = new Logger("CommandRouter");

/**
 * 构造一个"成功"的自定义命令结果
 * @param message 成功提示消息（支持 § 颜色代码）
 * @returns 状态为 Success 的命令结果对象
 */
function success(message: string): CustomCommandResult {
  return { status: CustomCommandStatus.Success, message };
}

/**
 * 构造一个"失败"的自定义命令结果
 * @param message 失败提示消息
 */
function failure(message: string): CustomCommandResult {
  return { status: CustomCommandStatus.Failure, message };
}

/**
 * 解析并规范化仓库名称参数的返回类型
 * - ok: true  → 解析成功，附带标准化后的 WarehouseId
 * - ok: false → 解析失败，附带错误消息字符串
 */
type ParseWarehouseIdResult = { ok: true; id: WarehouseId } | { ok: false; message: string };

/**
 * 解析原始字符串为标准化的仓库标识符（WarehouseId）
 *
 * 内部委托给 normalizeWarehouseId() 执行具体规范化逻辑，
 * 捕获可能抛出的异常并转换为友好的错误消息。
 *
 * @param raw 用户输入的原始仓库名称字符串
 * @returns 解析结果对象（ParseWarehouseIdResult）
 */
function parseWarehouseId(raw: string): ParseWarehouseIdResult {
  try {
    return { ok: true, id: normalizeWarehouseId(raw) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "无效的仓库名称" };
  }
}

/**
 * 从命令发起者中提取玩家对象（仅校验是否为玩家，不校验 op 权限）。
 * 用于 sw:organize 等所有玩家均可使用的命令。
 */
function parseAnyPlayer(origin: CustomCommandOrigin): Player | string {
  const entity = origin.sourceEntity ?? origin.initiator;
  if (!(entity instanceof Player)) return "该命令只能由玩家执行";
  return entity;
}

/**
 * 从命令发起者（CustomCommandOrigin）中提取玩家对象并进行权限校验
 *
 * 执行步骤：
 * 1. 优先使用 sourceEntity，回退到 initiator 作为命令发起实体
 * 2. 检查该实体是否为 Player 类型（非玩家执行的命令直接拒绝）
 * 3. 调用 canManageWarehouse() 检查玩家的 op 标签权限
 *
 * @param origin 命令发起者上下文（由 Minecraft 引擎传入）
 * @returns 校验通过时返回 Player 对象；失败时返回错误消息字符串
 */
function parseCommandPlayer(origin: CustomCommandOrigin): Player | string {
  const entity = origin.sourceEntity ?? origin.initiator;
  if (!(entity instanceof Player)) return "该命令只能由玩家执行";
  if (!canManageWarehouse(entity)) return "你没有权限执行仓库管理命令（需要 op 标签：/tag @s add op）";
  return entity;
}

/**
 * 安全地向指定玩家发送消息
 *
 * 由于部分操作在 system.runTimeout() 的异步回调中执行，此时玩家可能已经断线，
 * 直接调用 player.sendMessage() 会抛出异常。本函数捕获此异常以静默忽略。
 *
 * @param player 目标玩家对象
 * @param message 要发送的消息内容（支持 § 颜色代码）
 */
function trySendMessage(player: Player, message: string): void {
  try {
    player.sendMessage(message);
  } catch {
    // 玩家可能在命令回调与异步 system.run 执行之间断线，此处静默忽略异常
  }
}

/**
 * 构建命令的基础配置（所有自定义命令的公共字段）
 *
 * @param name        命令名称（如 "sw:create"）
 * @param description 命令描述（显示在帮助列表中的文本）
 * @returns 不包含 mandatoryParameters 的命令配置对象
 */
function commandBase(name: string, description: string): Omit<CustomCommand, "mandatoryParameters"> {
  return {
    name,
    description,
    permissionLevel: CommandPermissionLevel.Any,
    cheatsRequired: false,
  };
}

/**
 * 构建"区域型"命令的完整配置
 * 区域型命令包含：仓库名称 + 两组三维坐标（共 7 个必填参数）
 * 应用于：sw:create（创建仓库）、sw:resize（调整仓库区域）
 *
 * @param name        命令名称
 * @param description 命令描述
 * @returns 完整的 CustomCommand 配置对象（含 mandatoryParameters）
 */
function regionCommand(name: string, description: string): CustomCommand {
  return {
    ...commandBase(name, description),
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String }, // 仓库名称
      { name: "pos1", type: CustomCommandParamType.Location }, // 第一组坐标（支持 ~ ^ 相对坐标）
      { name: "pos2", type: CustomCommandParamType.Location }, // 第二组坐标（支持 ~ ^ 相对坐标）
    ],
  };
}

/**
 * 构建"名称型"命令的完整配置
 * 名称型命令仅包含一个仓库名称参数
 * 应用于：sw:rescan（重新扫描仓库）、sw:delete（删除仓库）
 *
 * @param name        命令名称
 * @param description 命令描述
 * @returns 完整的 CustomCommand 配置对象（含 mandatoryParameters）
 */
function namedCommand(name: string, description: string): CustomCommand {
  return {
    ...commandBase(name, description),
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  };
}

/**
 * CommandRouter 类 —— 自定义命令的路由与调度中心
 *
 * 负责将 Minecraft 游戏内自定义命令与后端的 WarehouseService 业务逻辑串联起来。
 * 采用"先注册 → 后路由"的模式：在 startup 事件中注册所有命令，
 * 命令触发时由对应的 handle* 方法进行参数校验和业务转发。
 */
export class CommandRouter {
  /** 标记是否已完成命令注册，避免重复注册 */
  private registered = false;

  /**
   * @param service     WarehouseService 实例，所有命令最终委托给该服务执行
   * @param repository  WarehouseRepository 实例，用于 sw:menu 等需要访问仓库数据的命令
   * @param configStore ModConfigStore 实例，用于 sw:menu 等需要模组配置的命令
   */
  constructor(
    private readonly service: WarehouseService,
    private readonly repository: WarehouseRepository,
    private readonly configStore: ModConfigStore
  ) {}

  /**
   * 注册所有自定义命令
   *
   * 该方法应在服务器启动阶段调用（通常由主入口文件触发）。
   * 内部订阅 system.beforeEvents.startup 事件，在引擎就绪后执行注册。
   * 通过 registered 标记防止重复调用。
   *
   * 注册的命令列表：
   * - sw:create  —— 创建仓库（区域型，7 参数）
   * - sw:resize  —— 调整仓库区域（区域型，7 参数）
   * - sw:rescan  —— 重新扫描仓库容器（名称型，1 参数）
   * - sw:delete  —— 删除仓库（名称型，1 参数）
   */
  register(): void {
    // 防止重复注册
    if (this.registered) return;
    this.registered = true;

    // 订阅引擎启动事件，在 startup 阶段注册自定义命令
    system.beforeEvents.startup.subscribe((event) => {
      // sw:create —— 创建一个新的 SmartWarehouse 仓库
      // 参数：仓库名称 + 两组坐标（共 3 个参数），坐标支持 ~ ^ 相对标记
      event.customCommandRegistry.registerCommand(
        regionCommand("sw:create", "创建 SmartWarehouse 仓库"),
        (origin, name: string, pos1: Vector3, pos2: Vector3) => this.handleCreate(origin, name, pos1, pos2)
      );

      // sw:resize —— 调整已有仓库的覆盖区域
      // 参数：仓库名称 + 两组坐标（共 3 个参数），坐标支持 ~ ^ 相对标记
      event.customCommandRegistry.registerCommand(
        regionCommand("sw:resize", "调整 SmartWarehouse 仓库区域"),
        (origin, name: string, pos1: Vector3, pos2: Vector3) => this.handleResize(origin, name, pos1, pos2)
      );

      // sw:rescan —— 重新扫描指定仓库区域内的所有容器
      // 参数：仅仓库名称（1 个）
      event.customCommandRegistry.registerCommand(
        namedCommand("sw:rescan", "重新扫描 SmartWarehouse 仓库容器"),
        (origin, name: string) => this.handleRescan(origin, name)
      );

      // sw:delete —— 删除指定的仓库及其所有数据
      // 参数：仅仓库名称（1 个）
      event.customCommandRegistry.registerCommand(
        namedCommand("sw:delete", "删除 SmartWarehouse 仓库"),
        (origin, name: string) => this.handleDelete(origin, name)
      );

      // sw:rescan_preview —— 预览重新扫描结果而不实际修改数据
      // 参数：仅仓库名称（1 个）
      event.customCommandRegistry.registerCommand(
        namedCommand("sw:rescan_preview", "预览 SmartWarehouse 仓库容器变更"),
        (origin, name: string) => this.handleRescanPreview(origin, name)
      );

      // sw:organize —— 整理玩家背包（快捷栏除外）
      // 无需参数，所有玩家可用
      event.customCommandRegistry.registerCommand(
        { ...commandBase("sw:organize", "整理玩家背包物品"), mandatoryParameters: [] },
        (origin) => this.handleOrganize(origin)
      );

      // sw:menu —— 打开 SmartWarehouse 主菜单
      // 无需参数，所有玩家可用（不依赖信物）
      event.customCommandRegistry.registerCommand(
        { ...commandBase("sw:menu", "打开 SmartWarehouse 主菜单"), mandatoryParameters: [] },
        (origin) => this.handleMenu(origin)
      );

      // sw:search —— 在附近且属于该玩家的仓库中搜索物品
      // 参数：搜索关键字
      event.customCommandRegistry.registerCommand(
        namedCommand("sw:search", "在附近仓库搜索物品"),
        (origin, query: string) => this.handleSearch(origin, query)
      );

      log.info(
        "Custom commands registered (sw:create/sw:resize/sw:rescan/sw:rescan_preview/sw:delete/sw:organize/sw:menu/sw:search)"
      );
    });
  }

  /**
   * 处理 sw:create 命令 —— 创建新仓库
   *
   * 处理流程：
   * 1. 解析并验证命令发起者（玩家 + 权限）
   * 2. 规范化仓库名称
   * 3. 校验坐标值均为整数
   * 4. 获取玩家当前维度 ID
   * 5. 通过 system.runTimeout() 异步调用 WarehouseService.createWarehouse()
   * 6. 反馈创建结果（成功 / 失败）
   *
   * @param origin 命令发起者上下文
   * @param name   仓库名称（原始字符串）
   * @param x1-z2  仓库区域对角线两点坐标
   * @returns 命令执行结果（同步返回提交状态，异步执行实际创建）
   */
  private handleCreate(origin: CustomCommandOrigin, name: string, pos1: Vector3, pos2: Vector3): CustomCommandResult {
    // 步骤 1：验证玩家身份与权限
    const player = parseCommandPlayer(origin);
    if (typeof player === "string") return failure(player);

    // 步骤 2：规范化仓库名称
    const normalized = parseWarehouseId(name);
    if (!normalized.ok) return failure(normalized.message);

    // 步骤 3：获取玩家当前所在维度
    const dimensionId = player.dimension.id;
    const pointA = { x: Math.floor(pos1.x), y: Math.floor(pos1.y), z: Math.floor(pos1.z) };
    const pointB = { x: Math.floor(pos2.x), y: Math.floor(pos2.y), z: Math.floor(pos2.z) };

    // 步骤 4：通过 system.runTimeout() 异步执行仓库创建
    system.runTimeout(() => {
      try {
        const warehouse = this.service.createWarehouse(
          normalized.id,
          dimensionId,
          pointA,
          pointB,
          "misc",
          true,
          player.id
        );
        trySendMessage(
          player,
          `§a仓库 "${warehouse.displayName}" 创建成功！共发现 ${Object.keys(warehouse.containers).length} 个容器`
        );
      } catch (error) {
        trySendMessage(player, `§c创建失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // 同步返回"已提交"状态，给玩家即时反馈
    return success(`已提交仓库创建请求: ${name}`);
  }

  /**
   * 处理 sw:resize 命令 —— 调整现有仓库的覆盖区域
   *
   * 与 handleCreate 流程类似，区别在于调用的服务方法不同：
   * - createWarehouse 需要 dimensionId，resize 不需要（复用已有维度信息）
   * - resize 不会重新创建仓库，仅更新区域边界并重新扫描容器
   *
   * @param origin 命令发起者上下文
   * @param name   仓库名称
   * @param pos1   新的区域第一组坐标
   * @param pos2   新的区域第二组坐标
   * @returns 命令执行结果
   */
  private handleResize(origin: CustomCommandOrigin, name: string, pos1: Vector3, pos2: Vector3): CustomCommandResult {
    // 验证玩家身份与权限
    const player = parseCommandPlayer(origin);
    if (typeof player === "string") return failure(player);

    // 规范化仓库名称
    const parsed = parseWarehouseId(name);
    if (!parsed.ok) return failure(parsed.message);

    const pointA = { x: Math.floor(pos1.x), y: Math.floor(pos1.y), z: Math.floor(pos1.z) };
    const pointB = { x: Math.floor(pos2.x), y: Math.floor(pos2.y), z: Math.floor(pos2.z) };

    // 延迟 1 tick 异步执行仓库区域调整
    system.runTimeout(() => {
      try {
        const warehouse = this.service.resizeWarehouse(parsed.id, pointA, pointB);
        trySendMessage(
          player,
          `§a仓库 "${warehouse.displayName}" 调整成功！共发现 ${Object.keys(warehouse.containers).length} 个容器`
        );
      } catch (error) {
        trySendMessage(player, `§c调整失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return success(`已提交仓库调整请求: ${name}`);
  }

  /**
   * 处理 sw:rescan 命令 —— 重新扫描指定仓库区域内的所有容器
   *
   * 该命令不会修改仓库的区域边界，仅触发一次容器扫描，
   * 用于在玩家手动修改了仓库区域内箱子/桶等容器后同步数据。
   *
   * @param origin 命令发起者上下文
   * @param name   仓库名称
   * @returns 命令执行结果
   */
  private handleRescan(origin: CustomCommandOrigin, name: string): CustomCommandResult {
    // 验证玩家身份与权限
    const player = parseCommandPlayer(origin);
    if (typeof player === "string") return failure(player);

    // 规范化仓库名称
    const parsed = parseWarehouseId(name);
    if (!parsed.ok) return failure(parsed.message);

    // 延迟 1 tick 异步执行重新扫描
    system.runTimeout(() => {
      try {
        const warehouse = this.service.rescanWarehouse(parsed.id);
        trySendMessage(
          player,
          `§a仓库 "${warehouse.displayName}" 重新扫描完成！共发现 ${Object.keys(warehouse.containers).length} 个容器`
        );
      } catch (error) {
        trySendMessage(player, `§c重新扫描失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return success(`已提交重新扫描请求: ${name}`);
  }

  /**
   * 处理 sw:rescan_preview 命令 —— 预览重新扫描结果而不实际修改数据。
   *
   * 调用 WarehouseService.previewRescanWarehouse() 执行扫描但不持久化，
   * 向玩家展示新增、移除、变化、未变的容器数量，帮助玩家在真正执行
   * 重扫前了解影响范围。
   *
   * @param origin 命令发起者上下文
   * @param name   仓库名称
   * @returns 命令执行结果
   */
  private handleRescanPreview(origin: CustomCommandOrigin, name: string): CustomCommandResult {
    const player = parseCommandPlayer(origin);
    if (typeof player === "string") return failure(player);

    const parsed = parseWarehouseId(name);
    if (!parsed.ok) return failure(parsed.message);

    system.runTimeout(() => {
      try {
        const diff = this.service.previewRescanWarehouse(parsed.id);
        trySendMessage(
          player,
          `§7[预览] 仓库 "${parsed.id}" 重扫变更：新增 §a${diff.added.length}§7，移除 §c${diff.removed.length}§7，变化 §e${diff.changed.length}§7，未变 §f${diff.unchanged.length}`
        );
      } catch (error) {
        trySendMessage(player, `§c预览失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return success(`已提交预览请求: ${name}`);
  }

  /**
   * 处理 sw:delete 命令 —— 删除指定仓库及其所有数据
   *
   * 注意：该操作不可逆。删除后仓库的所有容器索引数据将被永久移除。
   * 仓库在游戏世界中的实际方块不会受到影响。
   *
   * @param origin 命令发起者上下文
   * @param name   仓库名称
   * @returns 命令执行结果
   */
  private handleDelete(origin: CustomCommandOrigin, name: string): CustomCommandResult {
    // 验证玩家身份与权限
    const player = parseCommandPlayer(origin);
    if (typeof player === "string") return failure(player);

    // 规范化仓库名称
    const parsed = parseWarehouseId(name);
    if (!parsed.ok) return failure(parsed.message);

    // 延迟 1 tick 异步执行仓库删除
    system.runTimeout(() => {
      try {
        this.service.deleteWarehouse(parsed.id);
        trySendMessage(player, `§a仓库 ${parsed.id} 已删除`);
      } catch (error) {
        trySendMessage(player, `§c删除失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return success(`已提交仓库删除请求: ${name}`);
  }

  // ─── 整理命令 ───────────────────────────────────────────────────

  /**
   * 处理 sw:organize 命令 —— 整理玩家背包（快捷栏除外）。
   * 使用 SlotOrganizer 对玩家背包 9~35 号槽位进行排序+堆叠合并。
   */
  private handleOrganize(origin: CustomCommandOrigin): CustomCommandResult {
    const player = parseAnyPlayer(origin);
    if (typeof player === "string") return failure(player);

    system.runTimeout(() => {
      try {
        const invComp = player.getComponent("inventory") as EntityInventoryComponent | undefined;
        if (!invComp?.container) {
          trySendMessage(player, "§c无法获取背包容器");
          return;
        }

        const organizer = new SlotOrganizer();

        // Phase 1: 分析
        const analysis = organizer.analyze(invComp.container, {
          startSlot: 9,
          endSlot: 36,
        });

        // 打印混乱度评分
        const m = analysis.messiness;
        trySendMessage(
          player,
          `§7混乱度: §f${(m.total * 100).toFixed(0)}% ` +
            `§7(顺序 §e${(m.order * 100).toFixed(0)}% §7堆叠 §e${(m.stack * 100).toFixed(0)}%)`
        );

        if (m.total < 0.05) {
          trySendMessage(player, `§e背包已经很整齐了，无需整理`);
          return;
        }

        // Phase 2: 写入
        const result = organizer.apply(invComp.container, analysis);

        if (!result.success) {
          trySendMessage(player, `§c整理失败: ${result.error}`);
          return;
        }

        for (const line of formatOrganizeResult(result, "背包")) {
          trySendMessage(player, line);
        }
      } catch (error) {
        trySendMessage(player, `§c整理失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return success("已提交背包整理请求");
  }

  /**
   * 处理 sw:menu 命令 —— 打开 SmartWarehouse 主菜单。
   * 所有玩家可用，不依赖信物。
   */
  private handleMenu(origin: CustomCommandOrigin): CustomCommandResult {
    const player = parseAnyPlayer(origin);
    if (typeof player === "string") return failure(player);

    system.runTimeout(() => {
      showMainMenu(player, this.repository, this.service, this.configStore).catch((error) => {
        log.error(`MainMenu error for ${player.name}: ${error}`);
      });
    });

    return success("已打开 SmartWarehouse 主菜单");
  }

  /**
   * 处理 sw:search 命令 —— 在附近且属于该玩家的仓库中搜索物品。
   */
  private handleSearch(origin: CustomCommandOrigin, query: string): CustomCommandResult {
    const player = parseCommandPlayer(origin);
    if (typeof player === "string") return failure(player);

    // 查找附近且属于该玩家的仓库
    const warehouses = this.repository.loadAll();
    const isAdmin = canManageWarehouse(player);
    const nearbyOwned = filterNearbyOwnedWarehouses(
      warehouses,
      player.dimension.id,
      { x: player.location.x, z: player.location.z },
      WAREHOUSE_NEARBY_MARGIN,
      player.id,
      isAdmin
    );

    if (nearbyOwned.length === 0) {
      return failure("附近没有找到属于你的仓库");
    }

    const target = nearbyOwned[0];

    system.runTimeout(() => {
      try {
        const dimension = world.getDimension(target.dimensionId);
        const searchService = new SearchService();
        const result = searchService.search(target, query, dimension);
        const lines = formatSearchResult(result);
        for (const line of lines) {
          trySendMessage(player, line);
        }
        // 播放搜索标记粒子
        if (result.containerCount > 0) {
          const markerLocs = searchService.getMarkerLocations(result);
          if (markerLocs.length > 0) {
            const blLocs = markerLocs.map((l) => ({
              x: Math.floor(l.x),
              y: Math.floor(l.y),
              z: Math.floor(l.z),
            }));
            startMarkerParticles(player, target.dimensionId, blLocs, this.configStore);
          }
        }
      } catch (error) {
        trySendMessage(player, `§c搜索失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return success(`正在仓库 "${target.displayName}" 中搜索: ${query}`);
  }
}
