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
 * 显示仓库设置表单。
 * 通过 ModalForm 提供仓库名称、默认角色、启用状态、处理速度等设置项。
 * 底部操作：刷新统计、家庭成员、重新扫描、删除仓库、调整区域（互斥）。
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
    // 扫描失败时回退到简单概览
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
    .toggle("refreshStats", "§a刷新存储统计（重新扫描容器统计信息）")
    .toggle("familyConfig", "§b家庭成员（提交后打开）")
    .toggle("rescan", "§a重新扫描仓库（提交后执行）")
    .toggle("delete", "§c删除此仓库（提交后需确认）")
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
  const shouldRefreshStats = vals.refreshStats as boolean;
  const shouldOpenFamilyConfig = vals.familyConfig as boolean;
  const shouldRescan = vals.rescan as boolean;
  const shouldDelete = vals.delete as boolean;
  const shouldResize = vals.resize as boolean;

  // 操作性开关互斥：只能选一个
  const ops = [shouldRefreshStats, shouldOpenFamilyConfig, shouldRescan, shouldDelete, shouldResize].filter(Boolean).length;
  if (ops > 1) {
    player.sendMessage("§c刷新统计、家庭成员、重新扫描、删除仓库、调整区域只能同时开启一个，请重新选择");
    return;
  }

  try {
    // 1. 名称变更
    if (newName && newName.trim() !== "" && newName.trim() !== warehouse.displayName) {
      service.renameWarehouse(warehouseId, newName.trim());
    }

    // 2. 收集设置变更
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

  // ── 刷新存储统计 ──────────────────────────────
  if (shouldRefreshStats) {
    invalidateWarehouseStats(warehouseId, Object.keys(warehouse.containers));
    player.sendMessage("§a存储统计已刷新（下次打开设置页时将重新扫描容器）");
    return;
  }

  // ── 家庭成员配置（开关开启时弹出子菜单） ──
  if (shouldOpenFamilyConfig) {
    await showFamilyConfigMenu(player, warehouseId, repository, service);
    return;
  }

  // ── 重新扫描仓库 ──────────────────────────────
  if (shouldRescan) {
    system.runTimeout(() => {
      try {
        const result = service.rescanWarehouse(warehouseId);
        player.sendMessage(
          `§a仓库重新扫描完成！共发现 ${Object.keys(result.containers).length} 个容器`
        );
      } catch (error) {
        player.sendMessage(`§c重新扫描失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return;
  }

  // ── 删除仓库（仅在开关开启时弹出确认） ──────────
  if (shouldDelete) {
    await showDeleteWarehouseConfirm(player, warehouseId, warehouse.displayName, service);
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
 * 需要通过一个独立的 ActionForm 二次确认才能删除。
 *
 * @param player        - 操作的玩家
 * @param warehouseId   - 要删除的仓库 ID
 * @param displayName   - 仓库显示名称
 * @param service       - 仓库服务实例
 */
async function showDeleteWarehouseConfirm(
  player: Player,
  warehouseId: WarehouseId,
  displayName: string,
  service: WarehouseService
): Promise<void> {
  const result = await new ActionFormBuilder()
    .title("删除仓库")
    .body(`确定要删除仓库 "${displayName}" 吗？\n\n此操作不可撤销，所有容器数据将被清除。`)
    .button("confirm", "§c确认删除")
    .button("cancel", "取消")
    .show(player);

  if (!result) return;

  if (result.name === "confirm") {
    try {
      service.deleteWarehouse(warehouseId);
      player.sendMessage(`§a仓库 "${displayName}" 已删除`);
    } catch (error) {
      player.sendMessage(`§c删除仓库失败: ${error}`);
    }
  }
}
