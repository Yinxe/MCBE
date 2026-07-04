import type { Player } from "@minecraft/server";
import { system } from "@minecraft/server";
import { clearSession, setSession } from "../interaction/SelectionSessionStore";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseId, WarehouseSettings } from "../types";
import { ROLE_LABELS, ROLE_ORDER, SPEED_LABELS } from "../types";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { getWarehouseStats, formatWarehouseStats, invalidateWarehouseStats } from "./WarehouseStats";
import { showFamilyConfigMenu } from "./FamilyConfigMenu";
import { ModalFormBuilder, ActionFormBuilder } from "./FormHelper";

/**
 * 显示通用操作确认对话框。
 * @returns true 表示用户点击了确认
 */
async function showConfirm(player: Player, title: string, body: string, confirmLabel: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    new ActionFormBuilder()
      .title(title)
      .body(body)
      .button(confirmLabel, () => resolve(true))
      .button("取消", () => resolve(false))
      .show(player)
      .then(() => resolve(false)); // 取消/关闭也返回 false
  });
}

/**
 * 显示仓库设置表单。
 * 通过 ModalForm 提供仓库名称、默认角色、启用状态、处理速度等设置项。
 * 底部操作区：刷新容器、修复仓库、删除仓库、刷新统计、家庭成员、调整区域。
 *
 * @param player     - 操作的玩家
 * @param warehouseId - 要设置的仓库 ID
 * @param repository  - 仓库数据持久化仓储
 * @param service     - 仓库服务实例
 */
export async function showWarehouseSettingsMenu(
  player: Player,
  warehouseId: WarehouseId,
  repository: WarehouseRepository,
  service: WarehouseService
): Promise<void> {
  const warehouse = repository.load(warehouseId);
  if (!warehouse) {
    player.sendMessage("§c仓库不存在");
    return;
  }

  const settings = warehouse.settings;

  // ── 仓库存储统计（扫描容器实际内容） ────────────
  let statsLabel: string;
  try {
    const stats = getWarehouseStats(warehouse);
    statsLabel = formatWarehouseStats(stats);
  } catch {
    const cList = Object.values(warehouse.containers);
    statsLabel =
      `§7容器 §f${cList.length}个  ` +
      `§a普通${cList.filter((c) => c.role === "normal" && c.enabled).length} ` +
      `§b大宗${cList.filter((c) => c.role === "bulk" && c.enabled).length} ` +
      `§d杂项${cList.filter((c) => c.role === "misc" && c.enabled).length} ` +
      `§6输入${cList.filter((c) => c.role === "input" && c.enabled).length}` +
      (cList.filter((c) => !c.enabled).length > 0
        ? `  §8禁用${cList.filter((c) => !c.enabled).length}`
        : "");
  }

  // ── 主设置表单 ──────────────────────────────────
  const roleLabels = ROLE_ORDER.map((r) => ROLE_LABELS[r]);
  const defaultRoleIndex = ROLE_ORDER.indexOf(settings.defaultNewContainerRole);
  const speedLabels = Object.values(SPEED_LABELS);
  const speedValues = Object.keys(SPEED_LABELS).map(Number) as Array<keyof typeof SPEED_LABELS>;
  const defaultSpeedIndex = speedValues.indexOf(settings.processingSpeed as keyof typeof SPEED_LABELS);

  const form = new ModalFormBuilder()
    .title("仓库设置")
    .label("info", statsLabel)
    .textField("name", "仓库名称", "输入仓库名称...", { defaultValue: warehouse.displayName })
    .dropdown("defaultRole", "默认新容器角色", roleLabels, { defaultValueIndex: Math.max(0, defaultRoleIndex) })
    .dropdown("defaultEnabled", "新容器默认启用", ["是", "否"], { defaultValueIndex: settings.defaultNewContainerEnabled ? 0 : 1 })
    .dropdown("speed", "处理速度", speedLabels, { defaultValueIndex: Math.max(0, defaultSpeedIndex) })
    .toggle("autoCreate", "自动创建分类", { defaultValue: settings.autoCreateCategories })
    .toggle("warehouseEnabled", "启用仓库", { defaultValue: settings.enabled })
    .toggle("showBoundary", "显示边界光幕", { defaultValue: settings.showBoundary })
    .slider(
      "autoSortThreshold",
      "§7自动整理混乱度阈值\n" +
      "§7混乱度高于阈值时触发整理  §a40%§7推荐\n" +
      "§c0每次整理  §a20敏感  §a40适中  §e60宽松  §c100永不\n",
      0, 100,
      { defaultValue: settings.autoSortThreshold, valueStep: 20 },
    )
    .toggle("capacityWarning", "§e容量预警", { defaultValue: settings.capacityWarning })
    .label("opSep", "§8━━━ 操作 ━━━")
    .toggle("rescan", "§a刷新容器（重新扫描仓库容器列表）")
    .toggle("repair", "§6修复仓库（检查并修复仓库数据完整性）")
    .toggle("delete", "§c删除此仓库（不可撤销）")
    .toggle("refreshStats", "§a刷新存储统计（重新扫描容器统计信息）")
    .toggle("familyConfig", "§b家庭成员（提交后打开）")
    .toggle("resize", "§e调整此仓库区域（提交后需选择新区域）");

  const vals = await form.show(player);
  if (!vals) return;

  const newName = vals.name as string;
  const newRoleIndex = vals.defaultRole as number;
  const newEnabledIndex = vals.defaultEnabled as number;
  const newSpeedIndex = vals.speed as number;
  const newAutoCreate = vals.autoCreate as boolean;
  const newWarehouseEnabled = vals.warehouseEnabled as boolean;
  const newShowBoundary = vals.showBoundary as boolean;
  const newAutoSortThreshold = vals.autoSortThreshold as number;
  const newCapacityWarning = vals.capacityWarning as boolean;
  const shouldRescan = vals.rescan as boolean;
  const shouldRepair = vals.repair as boolean;
  const shouldDelete = vals.delete as boolean;
  const shouldRefreshStats = vals.refreshStats as boolean;
  const shouldOpenFamilyConfig = vals.familyConfig as boolean;
  const shouldResize = vals.resize as boolean;

  // 操作性开关互斥：只能选一个
  const actionOps = [shouldRescan, shouldRepair, shouldDelete, shouldRefreshStats, shouldOpenFamilyConfig, shouldResize];
  const ops = actionOps.filter(Boolean).length;
  if (ops > 1) {
    player.sendMessage("§c操作项只能同时开启一个，请重新选择");
    return;
  }

  // 先保存设置变更（所有操作之前）
  try {
    if (newName && newName.trim() !== "" && newName.trim() !== warehouse.displayName) {
      service.renameWarehouse(warehouseId, newName.trim());
    }

    const selectedRole = ROLE_ORDER[newRoleIndex];
    const selectedSpeed = speedValues[newSpeedIndex] as WarehouseSettings["processingSpeed"];
    const settingsUpdate: Partial<WarehouseSettings> = {};

    if (selectedRole && selectedRole !== settings.defaultNewContainerRole) {
      settingsUpdate.defaultNewContainerRole = selectedRole;
    }
    const newDefaultEnabled = newEnabledIndex === 0;
    if (newDefaultEnabled !== settings.defaultNewContainerEnabled) {
      settingsUpdate.defaultNewContainerEnabled = newDefaultEnabled;
    }
    if (selectedSpeed && selectedSpeed !== settings.processingSpeed) {
      settingsUpdate.processingSpeed = selectedSpeed;
    }
    if (newAutoCreate !== settings.autoCreateCategories) {
      settingsUpdate.autoCreateCategories = newAutoCreate;
    }
    if (newWarehouseEnabled !== settings.enabled) {
      settingsUpdate.enabled = newWarehouseEnabled;
    }
    if (newShowBoundary !== settings.showBoundary) {
      settingsUpdate.showBoundary = newShowBoundary;
    }
    if (newAutoSortThreshold !== settings.autoSortThreshold) {
      settingsUpdate.autoSortThreshold = newAutoSortThreshold;
    }
    if (newCapacityWarning !== settings.capacityWarning) {
      settingsUpdate.capacityWarning = newCapacityWarning;
    }

    if (Object.keys(settingsUpdate).length > 0) {
      service.updateSettings(warehouseId, settingsUpdate);
    }

    player.sendMessage("§a仓库设置已更新");
  } catch (error) {
    player.sendMessage(`§c更新设置失败: ${error}`);
    return;
  }

  // ── 刷新容器（确认后执行） ──────────────────────
  if (shouldRescan) {
    if (!await showConfirm(player, "刷新容器",
      `确定要刷新仓库 "${warehouse.displayName}" 的容器列表吗？\n\n` +
      `将重新扫描仓库区域内所有方块，更新容器列表。\n` +
      `现有角色和启用状态将保留。`,
      "§a确认刷新")) return;
    system.runTimeout(() => {
      try {
        const result = service.rescanWarehouse(warehouseId);
        player.sendMessage(`§a容器刷新完成！共发现 ${Object.keys(result.containers).length} 个容器`);
      } catch (error) {
        player.sendMessage(`§c容器刷新失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return;
  }

  // ── 修复仓库（确认后执行） ──────────────────────
  if (shouldRepair) {
    if (!await showConfirm(player, "修复仓库",
      `确定要修复仓库 "${warehouse.displayName}" 吗？\n\n` +
      `将执行以下修复步骤：\n` +
      `1. 重新扫描所有容器方块\n` +
      `2. 重建运行时索引\n` +
      `3. 重置存储统计缓存\n` +
      `4. 检查数据完整性`,
      "§e确认修复")) return;
    system.runTimeout(() => {
      try {
        invalidateWarehouseStats(warehouseId, Object.keys(warehouse.containers));
        const result = service.rescanWarehouse(warehouseId);
        player.sendMessage(`§a仓库修复完成！共发现 ${Object.keys(result.containers).length} 个容器，统计已重置`);
      } catch (error) {
        player.sendMessage(`§c仓库修复失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return;
  }

  // ── 删除仓库（确认后执行） ──────────────────────
  if (shouldDelete) {
    await showDeleteWarehouseConfirm(player, warehouseId, warehouse.displayName, service);
    return;
  }

  // ── 刷新存储统计（确认后执行） ──────────────────
  if (shouldRefreshStats) {
    if (!await showConfirm(player, "刷新统计",
      `确定要刷新仓库 "${warehouse.displayName}" 的存储统计吗？\n\n` +
      `将清除统计缓存并重新扫描所有容器，统计最新的存储容量信息。`,
      "§a确认刷新")) return;
    invalidateWarehouseStats(warehouseId, Object.keys(warehouse.containers));
    player.sendMessage("§a存储统计已刷新（下次打开设置页时将重新扫描容器）");
    return;
  }

  // ── 家庭成员配置（开关开启时弹出子菜单） ──
  if (shouldOpenFamilyConfig) {
    await showFamilyConfigMenu(player, warehouseId, repository, service);
    return;
  }

  // ── 调整仓库区域（提交后通过交互式选区选择新区域） ──
  if (shouldResize) {
    clearSession(player);
    setSession(player, {
      type: "resizeWarehouse",
      warehouseId,
    });
    player.sendMessage("§a请在两个对角位置使用信物点击方块来选择新的仓库区域");
  }
}

/**
 * 显示删除仓库的确认表单。
 */
async function showDeleteWarehouseConfirm(
  player: Player,
  warehouseId: WarehouseId,
  displayName: string,
  service: WarehouseService
): Promise<void> {
  await new ActionFormBuilder()
    .title("删除仓库")
    .body(`确定要删除仓库 "${displayName}" 吗？\n\n此操作不可撤销，所有容器数据将被清除。`)
    .button("§c确认删除", () => {
      try {
        service.deleteWarehouse(warehouseId);
        player.sendMessage(`§a仓库 "${displayName}" 已删除`);
      } catch (error) {
        player.sendMessage(`§c删除仓库失败: ${error}`);
      }
    })
    .button("取消")
    .show(player);
}
