import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { clearSession, setSession } from "../interaction/SelectionSessionStore";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseId, WarehouseSettings } from "../types";
import { ROLE_LABELS, ROLE_ORDER, SPEED_LABELS } from "../types";
import type { WarehouseService } from "../warehouse/WarehouseService";

/**
 * 显示仓库设置表单。
 * 通过 ModalForm 提供仓库名称、默认角色、启用状态、处理速度等设置项。
 * 表单中新增"删除此仓库"开关，提交后若开关为 true 则弹出二次确认。
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

  // ── 容器概况（从内存统计，不扫描容器） ─────────
  const cList = Object.values(warehouse.containers);
  const statsLine =
    `§7容器 §f${cList.length}个  ` +
    `§a普通${cList.filter((c) => c.role === "normal" && c.enabled).length} ` +
    `§b大宗${cList.filter((c) => c.role === "bulk" && c.enabled).length} ` +
    `§d杂项${cList.filter((c) => c.role === "misc" && c.enabled).length} ` +
    `§6输入${cList.filter((c) => c.role === "input" && c.enabled).length}` +
    (cList.filter((c) => !c.enabled).length > 0
      ? `  §8禁用${cList.filter((c) => !c.enabled).length}`
      : "");

  // ── 主设置表单 ──────────────────────────────────
  const roleLabels = ROLE_ORDER.map((r) => ROLE_LABELS[r]);
  const defaultRoleIndex = ROLE_ORDER.indexOf(settings.defaultNewContainerRole);
  const speedLabels = Object.values(SPEED_LABELS);
  const speedValues = Object.keys(SPEED_LABELS).map(Number) as Array<keyof typeof SPEED_LABELS>;
  const defaultSpeedIndex = speedValues.indexOf(settings.processingSpeed as keyof typeof SPEED_LABELS);

  const form = new ModalFormData()
    .title("仓库设置")
    .label(statsLine)
    .textField("仓库名称", "输入仓库名称...", { defaultValue: warehouse.displayName })
    .dropdown("默认新容器角色", roleLabels, { defaultValueIndex: Math.max(0, defaultRoleIndex) })
    .dropdown("新容器默认启用", ["是", "否"], { defaultValueIndex: settings.defaultNewContainerEnabled ? 0 : 1 })
    .dropdown("处理速度", speedLabels, { defaultValueIndex: Math.max(0, defaultSpeedIndex) })
    .toggle("自动创建分类", { defaultValue: settings.autoCreateCategories })
    .toggle("启用仓库", { defaultValue: settings.enabled })
    .toggle("显示边界光幕", { defaultValue: settings.showBoundary })
    .slider(
      "§7自动整理混乱度阈值\n" +
      "§7低于阈值→跳过 高于阈值→自动整理  §a40%§7推荐\n" +
      "§80关闭  §a20敏感  §a40适中  §e60宽松  §c80极松",
      0, 100,
      { defaultValue: settings.autoSortThreshold, valueStep: 20 },
    )
    .label("§8━━━ 操作 ━━━")
    .toggle("§c删除此仓库（提交后需确认）", { defaultValue: false })
    .toggle("§e调整此仓库区域（提交后需选择新区域）", { defaultValue: false });

  const response = await form.show(player);
  if (response.canceled) return;

  const values = response.formValues;
  if (!values || values.length < 12) {
    player.sendMessage("§c表单数据异常，请重试");
    return;
  }

  const newName = values[1] as string;
  const newRoleIndex = values[2] as number;
  const newEnabledIndex = values[3] as number;
  const newSpeedIndex = values[4] as number;
  const newAutoCreate = values[5] as boolean;
  const newWarehouseEnabled = values[6] as boolean;
  const newShowBoundary = values[7] as boolean;
  const newAutoSortThreshold = values[8] as number;
  const shouldDelete = values[10] as boolean;
  const shouldResize = values[11] as boolean;

  if (shouldDelete && shouldResize) {
    player.sendMessage("§c「删除仓库」和「调整区域」不能同时开启，请重新选择");
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

    if (Object.keys(settingsUpdate).length > 0) {
      service.updateSettings(warehouseId, settingsUpdate);
    }

    player.sendMessage("§a仓库设置已更新");
  } catch (error) {
    player.sendMessage(`§c更新设置失败: ${error}`);
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
    player.sendMessage("§a请在两个对角位置使用木锄点击方块来选择新的仓库区域");
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
  const form = new ActionFormData()
    .title("删除仓库")
    .body(`确定要删除仓库 "${displayName}" 吗？\n\n此操作不可撤销，所有容器数据将被清除。`)
    .button("§c确认删除")
    .button("取消");

  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;

  if (response.selection === 0) {
    try {
      service.deleteWarehouse(warehouseId);
      player.sendMessage(`§a仓库 "${displayName}" 已删除`);
    } catch (error) {
      player.sendMessage(`§c删除仓库失败: ${error}`);
    }
  }
}
