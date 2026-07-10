/**
 * ============================================================================
 * CommandRouter —— SmartWarehouse 自定义命令路由层
 * ============================================================================
 *
 * 职责概述：
 * 1. 在服务器启动阶段注册所有自定义命令
 * 2. 解析参数后委托给 WarehouseService
 * 3. 通过 trySendMessage() 安全反馈结果
 *
 * 参数类型：
 * - 区域型命令（create / resize）：string 名称 + 2 个 Location 参数
 * - 名称型命令（rescan / delete / search）：仅 string 名称参数
 * ============================================================================
 */

import {
  world,
  CommandPermissionLevel,
  CustomCommandParamType,
  Player,
  system,
  type CustomCommand,
  type Vector3,
} from "@minecraft/server";
import type { EntityInventoryComponent } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
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

const log = new Logger("CommandRouter");

type ParseResult = { ok: true; id: WarehouseId } | { ok: false; message: string };

function parseWarehouseId(raw: string): ParseResult {
  try { return { ok: true, id: normalizeWarehouseId(raw) }; }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : "无效的仓库名称" }; }
}

function trySendMessage(player: Player, message: string): void {
  try { player.sendMessage(message); } catch { }
}

function commandBase(name: string, description: string): Omit<CustomCommand, "mandatoryParameters"> {
  return { name, description, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false };
}

function regionCommand(name: string, description: string): CustomCommand {
  return {
    ...commandBase(name, description),
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
      { name: "pos1", type: CustomCommandParamType.Location },
      { name: "pos2", type: CustomCommandParamType.Location },
    ],
  };
}

function namedCommand(name: string, description: string): CustomCommand {
  return {
    ...commandBase(name, description),
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  };
}

export class CommandRouter {
  private registered = false;

  constructor(
    private readonly service: WarehouseService,
    private readonly repository: WarehouseRepository,
    private readonly configStore: ModConfigStore
  ) {}

  register(): void {
    if (this.registered) return;
    this.registered = true;

    system.beforeEvents.startup.subscribe((event) => {
      const r = event.customCommandRegistry;

      defineCommand(r, regionCommand("sw:create", "创建 SmartWarehouse 仓库"),
        ({ player, params }) => this.handleCreate(player, params.name as string, params.pos1 as Vector3, params.pos2 as Vector3));

      defineCommand(r, regionCommand("sw:resize", "调整 SmartWarehouse 仓库区域"),
        ({ player, params }) => this.handleResize(player, params.name as string, params.pos1 as Vector3, params.pos2 as Vector3));

      defineCommand(r, namedCommand("sw:rescan", "重新扫描 SmartWarehouse 仓库容器"),
        ({ player, params }) => this.handleRescan(player, params.name as string));

      defineCommand(r, namedCommand("sw:delete", "删除 SmartWarehouse 仓库"),
        ({ player, params }) => this.handleDelete(player, params.name as string));

      defineCommand(r, namedCommand("sw:rescan_preview", "预览 SmartWarehouse 仓库容器变更"),
        ({ player, params }) => this.handleRescanPreview(player, params.name as string));

      defineCommand(r, { ...commandBase("sw:organize", "整理玩家背包物品"), mandatoryParameters: [] },
        ({ player }) => this.handleOrganize(player));

      defineCommand(r, { ...commandBase("sw:menu", "打开 SmartWarehouse 主菜单"), mandatoryParameters: [] },
        ({ player }) => this.handleMenu(player));

      defineCommand(r, namedCommand("sw:search", "在附近仓库搜索物品"),
        ({ player, params }) => this.handleSearch(player, params.name as string));

      log.info("Custom commands registered");
    });
  }

  // ─── 命令处理 ───────────────────────────────────────────────

  private handleCreate(player: Player, name: string, pos1: Vector3, pos2: Vector3): void {
    if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令（需要 op 标签）"); return; }
    const normalized = parseWarehouseId(name);
    if (!normalized.ok) { player.sendMessage(`§c${normalized.message}`); return; }

    const dimensionId = player.dimension.id;
    const pointA = { x: Math.floor(pos1.x), y: Math.floor(pos1.y), z: Math.floor(pos1.z) };
    const pointB = { x: Math.floor(pos2.x), y: Math.floor(pos2.y), z: Math.floor(pos2.z) };

    system.runTimeout(() => {
      try {
        const warehouse = this.service.createWarehouse(normalized.id, dimensionId, pointA, pointB, "misc", true, player.id);
        trySendMessage(player, `§a仓库 "${warehouse.displayName}" 创建成功！共发现 ${Object.keys(warehouse.containers).length} 个容器`);
      } catch (error) {
        trySendMessage(player, `§c创建失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private handleResize(player: Player, name: string, pos1: Vector3, pos2: Vector3): void {
    if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令（需要 op 标签）"); return; }
    const parsed = parseWarehouseId(name);
    if (!parsed.ok) { player.sendMessage(`§c${parsed.message}`); return; }

    const pointA = { x: Math.floor(pos1.x), y: Math.floor(pos1.y), z: Math.floor(pos1.z) };
    const pointB = { x: Math.floor(pos2.x), y: Math.floor(pos2.y), z: Math.floor(pos2.z) };

    system.runTimeout(() => {
      try {
        const warehouse = this.service.resizeWarehouse(parsed.id, pointA, pointB);
        trySendMessage(player, `§a仓库 "${warehouse.displayName}" 调整成功！共发现 ${Object.keys(warehouse.containers).length} 个容器`);
      } catch (error) {
        trySendMessage(player, `§c调整失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private handleRescan(player: Player, name: string): void {
    if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令（需要 op 标签）"); return; }
    const parsed = parseWarehouseId(name);
    if (!parsed.ok) { player.sendMessage(`§c${parsed.message}`); return; }

    system.runTimeout(() => {
      try {
        const warehouse = this.service.rescanWarehouse(parsed.id);
        trySendMessage(player, `§a仓库 "${warehouse.displayName}" 重新扫描完成！共发现 ${Object.keys(warehouse.containers).length} 个容器`);
      } catch (error) {
        trySendMessage(player, `§c重新扫描失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private handleRescanPreview(player: Player, name: string): void {
    if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令（需要 op 标签）"); return; }
    const parsed = parseWarehouseId(name);
    if (!parsed.ok) { player.sendMessage(`§c${parsed.message}`); return; }

    system.runTimeout(() => {
      try {
        const diff = this.service.previewRescanWarehouse(parsed.id);
        trySendMessage(player,
          `§7[预览] 仓库 "${parsed.id}" 重扫变更：新增 §a${diff.added.length}§7，移除 §c${diff.removed.length}§7，变化 §e${diff.changed.length}§7，未变 §f${diff.unchanged.length}`
        );
      } catch (error) {
        trySendMessage(player, `§c预览失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private handleDelete(player: Player, name: string): void {
    if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令（需要 op 标签）"); return; }
    const parsed = parseWarehouseId(name);
    if (!parsed.ok) { player.sendMessage(`§c${parsed.message}`); return; }

    system.runTimeout(() => {
      try {
        this.service.deleteWarehouse(parsed.id);
        trySendMessage(player, `§a仓库 ${parsed.id} 已删除`);
      } catch (error) {
        trySendMessage(player, `§c删除失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private handleOrganize(player: Player): void {
    system.runTimeout(() => {
      try {
        const invComp = player.getComponent("inventory") as EntityInventoryComponent | undefined;
        if (!invComp?.container) { trySendMessage(player, "§c无法获取背包容器"); return; }

        const organizer = new SlotOrganizer();
        const analysis = organizer.analyze(invComp.container, { startSlot: 9, endSlot: 36 });
        const m = analysis.messiness;
        trySendMessage(player, `§7混乱度: §f${(m.total * 100).toFixed(0)}% §7(顺序 §e${(m.order * 100).toFixed(0)}% §7堆叠 §e${(m.stack * 100).toFixed(0)}%)`);

        if (m.total < 0.05) { trySendMessage(player, "§e背包已经很整齐了，无需整理"); return; }

        const result = organizer.apply(invComp.container, analysis);
        if (!result.success) { trySendMessage(player, `§c整理失败: ${result.error}`); return; }

        for (const line of formatOrganizeResult(result, "背包")) trySendMessage(player, line);
      } catch (error) {
        trySendMessage(player, `§c整理失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private handleMenu(player: Player): void {
    system.runTimeout(() => {
      showMainMenu(player, this.repository, this.service, this.configStore).catch((error) => {
        log.error(`MainMenu error for ${player.name}: ${error}`);
      });
    });
  }

  private handleSearch(player: Player, query: string): void {
    if (!canManageWarehouse(player)) { player.sendMessage("§c你没有权限执行仓库管理命令（需要 op 标签）"); return; }

    const warehouses = this.repository.loadAll();
    const isAdmin = canManageWarehouse(player);
    const nearbyOwned = filterNearbyOwnedWarehouses(
      warehouses, player.dimension.id,
      { x: player.location.x, z: player.location.z },
      WAREHOUSE_NEARBY_MARGIN, player.id, isAdmin
    );

    if (nearbyOwned.length === 0) { trySendMessage(player, "§c附近没有找到属于你的仓库"); return; }

    const target = nearbyOwned[0];
    system.runTimeout(() => {
      try {
        const dimension = world.getDimension(target.dimensionId);
        const searchService = new SearchService();
        const result = searchService.search(target, query, dimension);
        for (const line of formatSearchResult(result)) trySendMessage(player, line);

        if (result.containerCount > 0) {
          const markerLocs = searchService.getMarkerLocations(result);
          if (markerLocs.length > 0) {
            startMarkerParticles(player, target.dimensionId,
              markerLocs.map(l => ({ x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) })),
              this.configStore);
          }
        }
      } catch (error) {
        trySendMessage(player, `§c搜索失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}
